import "server-only";
import { ZONA_ARGENTINA, diaDeCalendario } from "@/core/tiempo/zona-horaria";
import type { ComandoAceptarParteDeFactura, ResultadoAceptarParteDeFactura } from "@/core/features/compras/factura-proveedor.schema";
import { mensajeSeccionDesactivada } from "@/core/features/movimientos/secciones.guard";
import { calcularPayloadHash, esChoqueDeClaveIdempotenciaDeOperacion, esChoqueDeFacturaUnica, esChoqueDeParteYaExistente, MENSAJE_CONFLICTO_IDEMPOTENCIA } from "@/core/movimientos/public-servidor";
import { exito, fracaso } from "@/core/resultado-caso";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { productoDisponibleEn } from "@/server/lecturas/catalogo/disponibilidad";
import { obtenerSeccionPropia } from "@/server/lecturas/movimientos/saldos";
import { escribirLineasDeMovimientoStock, escribirOperacionDeStock } from "@/server/persistencia/movimientos/escribir-movimiento-de-stock";
import { cargarOperacionPorClaveIdempotencia, chequearIdempotencia, registrarResultadoIdempotente } from "@/server/persistencia/movimientos/idempotencia";
import { bloquearFactura, cargarEstadoDePropuesta, cargarPropuestaParaAceptar } from "@/server/persistencia/compras/cargar-factura-proveedor";
import { escribirParteRecibida, marcarPropuestaAceptada } from "@/server/persistencia/compras/escribir-factura-proveedor";

/** Lo que tira la transacción cuando otra aceptación ganó en el medio: hace ROLLBACK de todo lo escrito y el `.catch` lo traduce. */
class PropuestaYaAceptada extends Error {}

const MENSAJE_YA_ACEPTADA = "Esta parte de la factura ya fue aceptada: no se cargó nada de nuevo.";
const MENSAJE_NO_ENCONTRADA = "No se encontró esa parte de factura para aceptar en esta sucursal.";

/**
 * Caso de uso «aceptar mi parte de una factura de proveedor» (E3a, ADR-041): la sucursal DESTINO acepta la propuesta que le hizo la sucursal que compró. Recién acá entran su stock, su costo y su gasto.
 *
 * `import "server-only"` y SIN `"use server"`: no chequea permisos (la Server Action pidió `proceso_compra` en la sucursal activa, que tiene que ser la destino) ni el formato (`guardComandoAceptarParteDeFactura`).
 *
 * En UNA transacción SERIALIZABLE:
 *  1. I3: la clave y la huella van en la compra que crea la aceptación (`Operacion`);
 *  2. la propuesta (la RLS la deja ver a sus dos puntas: el caso de uso exige que la destino sea la sucursal activa, si no «no se encontró»);
 *  3. `SELECT … FOR UPDATE` de la cabecera: serializa contra la anulación y contra otra aceptación; anulada → rechazo;
 *  4. ya aceptada → rechazo sin escribir; sección propia y activa; fecha de stock entre la fecha de la factura y hoy (días en hora argentina); cada producto habilitado en esta sucursal;
 *  5. escribe la compra (Operacion COMPRA con la fecha de stock + una línea del Kardex por renglón de la propuesta, con su renglón, su cantidad y sus pesos TAL CUAL), la parte RECIBIDA (con el porcentaje de la
 *     propuesta) y marca la propuesta ACEPTADA con `WHERE estado = 'PENDIENTE'`: si no tocó ninguna fila, ganó otra aceptación y se deshace todo; la segunda barrera es el único (factura, sucursal) de la parte.
 *
 * @contract La sucursal destino acepta exactamente lo que le propusieron y entra al stock con la fecha que elige; una propuesta se acepta una sola vez.
 * @idempotency I3 (claveIdempotencia + payloadHash en la Operacion de la aceptación), dentro de la misma transacción; además la guarda del UPDATE y el único de la parte.
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento), con candado sobre la cabecera de la factura.
 * @sideEffects registrarCambioAuditado (la aceptación).
 * @ficha permiso=proceso_compra transaccion=SERIALIZABLE idempotencia=I3 auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function aceptarPropuestaDeFacturaCasoDeUso(
  actor: Pick<ContextoDeAccion, "usuarioId" | "sucursalId" | "sucursalNombre" | "db" | "transaccion" | "ahora">,
  comando: ComandoAceptarParteDeFactura
): Promise<ResultadoAceptarParteDeFactura> {
  const payloadHash = calcularPayloadHash("ACEPTAR_PARTE_FACTURA", actor.sucursalId, { propuestaId: comando.propuestaId, seccionId: comando.seccionId, fechaStock: comando.fechaStock });

  return conTransaccionSerializable(actor.transaccion, async (tx): Promise<ResultadoAceptarParteDeFactura> => {
    const chequeo = await chequearIdempotencia(tx, comando.claveIdempotencia, payloadHash);
    if (chequeo.estado === "duplicado") return exito(chequeo.mensaje, { repetida: true, operacionId: null });
    if (chequeo.estado === "conflicto") return fracaso("CONFLICTO_IDEMPOTENCIA", MENSAJE_CONFLICTO_IDEMPOTENCIA);

    const propuesta = await cargarPropuestaParaAceptar(tx, comando.propuestaId);
    if (!propuesta || propuesta.destinoSucursalId !== actor.sucursalId) return fracaso("NO_ENCONTRADA", MENSAJE_NO_ENCONTRADA);
    const factura = await bloquearFactura(tx, propuesta.facturaProveedorId);
    if (!factura) return fracaso("NO_ENCONTRADA", MENSAJE_NO_ENCONTRADA);
    if (factura.anuladaEn) return fracaso("FACTURA_ANULADA", "La factura fue anulada: esta parte ya no se puede aceptar.");
    if (propuesta.estado !== "PENDIENTE") return fracaso("YA_ACEPTADA", MENSAJE_YA_ACEPTADA);

    const seccion = await obtenerSeccionPropia(comando.seccionId, actor.sucursalId, tx);
    if (!seccion) return fracaso("SECCION_NO_ENCONTRADA", "No se encontró la sección.");
    if (!seccion.activa) return fracaso("SECCION_INACTIVA", mensajeSeccionDesactivada(seccion.nombre));

    const diaStock = diaDeCalendario(comando.fechaStock, ZONA_ARGENTINA);
    const diaFactura = diaDeCalendario(factura.fecha, ZONA_ARGENTINA);
    const hoy = diaDeCalendario(actor.ahora, ZONA_ARGENTINA);
    if (diaStock < diaFactura || diaStock > hoy) return fracaso("FECHA_FUERA_DE_RANGO", `La fecha de stock tiene que estar entre la fecha de la factura (${diaFactura}) y hoy (${hoy}).`);

    for (const r of propuesta.renglones) {
      if (!(await productoDisponibleEn(actor.sucursalId, r.productoId, tx))) {
        return fracaso("PRODUCTO_NO_DISPONIBLE", `«${r.productoNombre}» no está disponible en «${actor.sucursalNombre}»: pedí que lo habiliten o que anulen la factura y la vuelvan a cargar.`);
      }
    }

    const operacion = await escribirOperacionDeStock(tx, {
      sucursalId: actor.sucursalId,
      proceso: "COMPRA",
      fecha: comando.fechaStock,
      proveedorId: factura.proveedorId,
      nroFactura: factura.nroFactura,
      seccionDestinoId: null,
      motivoId: null,
      destinoId: null,
      detalleLibre: null,
      usuarioId: actor.usuarioId,
      claveIdempotencia: comando.claveIdempotencia,
      payloadHash,
    });
    const escritas = await escribirLineasDeMovimientoStock(
      tx,
      propuesta.renglones.map((r) => ({
        operacionId: operacion.id,
        productoId: r.productoId,
        seccionId: seccion.id,
        proceso: "COMPRA",
        cantidad: r.cantidadStock,
        loteVencimiento: r.loteVencimiento,
        detalle: r.detalle,
        precioTotal: r.precioTotal,
        precioPorUnidadStock: r.precioPorUnidadStock,
        facturaProveedorRenglonId: r.facturaProveedorRenglonId,
      }))
    );
    const parte = await escribirParteRecibida(tx, {
      facturaProveedorId: propuesta.facturaProveedorId,
      sucursalId: actor.sucursalId,
      porcentajeDeclaradoBp: propuesta.porcentajeDeclaradoBp,
      operacionId: operacion.id,
      recibidaEn: comando.fechaStock,
      recibidaPorId: actor.usuarioId,
    });
    const marcadas = await marcarPropuestaAceptada(tx, { propuestaId: propuesta.id, parteId: parte.id, aceptadaEn: actor.ahora, aceptadaPorId: actor.usuarioId });
    if (marcadas !== 1) throw new PropuestaYaAceptada();

    await registrarCambioAuditado(tx, {
      entidad: "FacturaProveedor",
      entidadId: propuesta.facturaProveedorId,
      descripcion: `Parte de la factura de proveedor${factura.nroFactura ? ` ${factura.nroFactura}` : ""} aceptada en «${actor.sucursalNombre}» (fecha de stock ${diaStock})`,
      campo: "parteAceptada",
      valorAnterior: "PENDIENTE",
      valorNuevo: "ACEPTADA",
      actorId: actor.usuarioId,
      sucursalId: actor.sucursalId,
    });

    const mensaje = `Parte aceptada: ${escritas.movimientos} movimiento(s) entraron al stock de esta sucursal con fecha ${diaStock}.`;
    await registrarResultadoIdempotente(tx, operacion.id, mensaje);
    return exito(mensaje, { repetida: false, operacionId: operacion.id });
  }, undefined, undefined, true).catch(async (e): Promise<ResultadoAceptarParteDeFactura> => {
    if (e instanceof PropuestaYaAceptada || esChoqueDeParteYaExistente(e)) return fracaso("YA_ACEPTADA", MENSAJE_YA_ACEPTADA);
    // El número de la factura ya está en una compra de esta sucursal: o ganó otra aceptación de la MISMA propuesta (entonces es «ya aceptada»), o la sucursal la había cargado como compra suelta.
    if (esChoqueDeFacturaUnica(e) && (await cargarEstadoDePropuesta(actor.db, comando.propuestaId)) === "ACEPTADA") return fracaso("YA_ACEPTADA", MENSAJE_YA_ACEPTADA);
    if (esChoqueDeFacturaUnica(e)) return fracaso("FACTURA_DUPLICADA", "Ya hay una compra con esa factura cargada en esta sucursal: anulá una de las dos (la compra suelta o la factura) antes de aceptar.");
    if (esChoqueDeClaveIdempotenciaDeOperacion(e)) {
      const ganador = await cargarOperacionPorClaveIdempotencia(actor.db, comando.claveIdempotencia);
      if (ganador && ganador.payloadHash === payloadHash && ganador.resultadoMensaje !== null) return exito(ganador.resultadoMensaje, { repetida: true, operacionId: null });
      return fracaso("CONFLICTO_IDEMPOTENCIA", MENSAJE_CONFLICTO_IDEMPOTENCIA);
    }
    throw e;
  });
}
