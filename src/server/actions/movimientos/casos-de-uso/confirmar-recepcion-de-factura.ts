import "server-only";
import {
  MENSAJE_RECEPCION_NO_ENCONTRADA,
  MENSAJE_RECEPCION_YA_RECIBIDA,
  decidirConfirmacionDeRecepcion,
  type SeccionParaRecibir,
} from "@/core/compras/public";
import type { ComandoConfirmarRecepcionDeFactura, ResultadoConfirmarRecepcionDeFactura } from "@/core/features/compras/factura-proveedor.schema";
import { mensajeSeccionDesactivada } from "@/core/features/movimientos/secciones.guard";
import { exito, fracaso } from "@/core/resultado-caso";
import { ZONA_ARGENTINA, diaDeCalendario } from "@/core/tiempo/zona-horaria";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { productoDisponibleEn } from "@/server/lecturas/catalogo/disponibilidad";
import { obtenerSeccionPropia } from "@/server/lecturas/movimientos/saldos";
import { bloquearFactura, cargarParteDeFacturaEnSucursal, cargarRenglonesParaRecibir } from "@/server/persistencia/compras/cargar-factura-proveedor";
import { confirmarParteRecibida } from "@/server/persistencia/compras/escribir-factura-proveedor";
import { escribirLineasDeMovimientoStock, escribirOperacionDeStock } from "@/server/persistencia/movimientos/escribir-movimiento-de-stock";

/** Lo que tira la transacción cuando otra confirmación ganó en el medio: hace ROLLBACK de todo lo escrito y el `.catch` lo traduce. */
class ParteYaRecibida extends Error {}

/**
 * Caso de uso «confirmar la recepción de una compra pendiente» (Compras N3-a, recepción separada; docs/diseno-compras-paridad-escalera-2026-11-16.md, CU-2): un gerente o administrador de la sucursal confirma que llegó la mercadería de una factura
 * cargada «pendiente de recibir» y elige la sección (depósito) y la fecha de stock. Recién acá entran su stock, su costo y su gasto: la compra (`Operacion` COMPRA + una línea del Kardex por renglón, con su renglón) se escribe como la escribe
 * «cargar factura» cuando el módulo está apagado.
 *
 * `import "server-only"` y SIN `"use server"`: no chequea permisos (la Server Action pidió `compra_recibir` en la sucursal activa: del módulo `recepcion_de_compras`, piso administrador) ni el formato (`guardComandoConfirmarRecepcionDeFactura`).
 *
 * En UNA transacción SERIALIZABLE:
 *  1. `SELECT … FOR UPDATE` de la cabecera de la factura (serializa contra la anulación y contra otra confirmación); no existe en la empresa (la RLS esconde las ajenas) → «no se encontró»;
 *  2. `decidirConfirmacionDeRecepcion` (regla pura, contrastada con el oráculo): la parte es de esta sucursal, la factura no está anulada, la parte sigue pendiente, la sección es de esta sucursal y está activa, y la fecha de stock está
 *     entre la fecha de la factura y hoy (días en hora argentina); cada producto sigue habilitado en esta sucursal;
 *  3. arma las líneas desde los renglones guardados (la parte única recibe el renglón ENTERO, con su cantidad, sus pesos, su lote y su detalle TAL CUAL), escribe la compra y marca la parte RECIBIDA con su compra, con `WHERE estado = 'PENDIENTE'`:
 *     si no tocó ninguna fila, ganó otra confirmación y se deshace todo (no queda compra huérfana); la segunda barrera es el disparador de la base (una parte recibida no vuelve atrás);
 *  4. audita (`FacturaProveedor`, campo `recepcion`, de PENDIENTE a RECIBIDA: quién (`actorId`), cuándo (el registro) y, en la descripción, la sección y la fecha de stock).
 * Idempotente por ESTADO, sin clave de reintento: confirmar dos veces devuelve «ya recibida» sin crear stock de nuevo.
 *
 * @contract Confirma la recepción de la parte pendiente de una sucursal exactamente una vez: entra su stock con la fecha elegida, o no entra nada.
 * @idempotency POR_ESTADO: la guarda `WHERE estadoRecepcion = 'PENDIENTE'` y el candado de la cabecera; una segunda confirmación recibe «ya recibida».
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento), con candado sobre la cabecera de la factura.
 * @sideEffects registrarCambioAuditado (la recepción).
 * @ficha permiso=compra_recibir transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function confirmarRecepcionDeFacturaCasoDeUso(
  actor: Pick<ContextoDeAccion, "usuarioId" | "sucursalId" | "sucursalNombre" | "db" | "transaccion" | "ahora">,
  comando: ComandoConfirmarRecepcionDeFactura
): Promise<ResultadoConfirmarRecepcionDeFactura> {
  return conTransaccionSerializable(actor.transaccion, async (tx): Promise<ResultadoConfirmarRecepcionDeFactura> => {
    const factura = await bloquearFactura(tx, comando.facturaId);
    if (!factura) return fracaso("NO_ENCONTRADA", MENSAJE_RECEPCION_NO_ENCONTRADA);

    const parte = await cargarParteDeFacturaEnSucursal(tx, factura.id, actor.sucursalId);
    const seccion = await obtenerSeccionPropia(comando.seccionId, actor.sucursalId, tx);
    const diaFactura = diaDeCalendario(factura.fecha, ZONA_ARGENTINA);
    const diaStock = diaDeCalendario(comando.fechaStock, ZONA_ARGENTINA);
    const hoy = diaDeCalendario(actor.ahora, ZONA_ARGENTINA);
    const estadoDeLaSeccion: SeccionParaRecibir = !seccion ? "AJENA" : seccion.activa ? "PROPIA_ACTIVA" : "INACTIVA";
    const decision = decidirConfirmacionDeRecepcion({
      esDeLaSucursalDelActor: parte !== null,
      facturaAnulada: Boolean(factura.anuladaEn),
      estadoDeLaParte: parte?.estadoRecepcion === "PENDIENTE" ? "PENDIENTE" : "RECIBIDA",
      seccion: estadoDeLaSeccion,
      diaFactura,
      diaStock,
      hoy,
    });
    if (!decision.ok) {
      if (decision.codigo === "SECCION_INACTIVA") return fracaso("SECCION_INACTIVA", mensajeSeccionDesactivada(seccion?.nombre ?? ""));
      return fracaso(decision.codigo, decision.mensaje);
    }
    // La regla ya garantizó parte y sección; esto solo lo deja claro para el compilador.
    if (!parte || !seccion) return fracaso("NO_ENCONTRADA", MENSAJE_RECEPCION_NO_ENCONTRADA);

    const renglones = await cargarRenglonesParaRecibir(tx, factura.id);
    if (!renglones.length) return fracaso("SIN_LINEAS", "La compra no tiene mercadería para recibir.");
    for (const r of renglones) {
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
      detalleLibre: factura.detalleLibre,
      usuarioId: actor.usuarioId,
      claveIdempotencia: null,
      payloadHash: null,
    });
    const escritas = await escribirLineasDeMovimientoStock(
      tx,
      renglones.map((r) => ({
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
    const confirmadas = await confirmarParteRecibida(tx, { parteId: parte.id, operacionId: operacion.id, recibidaEn: comando.fechaStock, recibidaPorId: actor.usuarioId });
    if (confirmadas !== 1) throw new ParteYaRecibida();

    await registrarCambioAuditado(tx, {
      entidad: "FacturaProveedor",
      entidadId: factura.id,
      descripcion: `Recepción de la compra${factura.nroFactura ? ` ${factura.nroFactura}` : ""} confirmada en «${actor.sucursalNombre}» (sección «${seccion.nombre}», fecha de stock ${diaStock})`,
      campo: "recepcion",
      valorAnterior: "PENDIENTE",
      valorNuevo: "RECIBIDA",
      actorId: actor.usuarioId,
      sucursalId: actor.sucursalId,
    });

    return exito(`Recepción confirmada: ${escritas.movimientos} movimiento(s) entraron al stock de esta sucursal con fecha ${diaStock}.`, { operacionId: operacion.id, movimientos: escritas.movimientos });
  }).catch((e): ResultadoConfirmarRecepcionDeFactura => {
    if (e instanceof ParteYaRecibida) return fracaso("YA_RECIBIDA", MENSAJE_RECEPCION_YA_RECIBIDA);
    throw e;
  });
}
