import "server-only";
import {
  MENSAJE_RECEPCION_NO_ENCONTRADA,
  MENSAJE_RECEPCION_YA_RECIBIDA,
  decidirConfirmacionDeRecepcion,
  prorratearPrecioDeRenglon,
  validarEntradasDeRecepcion,
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
import { rechazoDeOrdenDeLaBase } from "@/server/persistencia/compras/errores-de-orden-de-compra";
import { escribirLineasDeMovimientoStock, escribirOperacionDeStock } from "@/server/persistencia/movimientos/escribir-movimiento-de-stock";

/** Lo que tira la transacción cuando otra confirmación ganó en el medio: hace ROLLBACK de todo lo escrito y el `.catch` lo traduce. */
class ParteYaRecibida extends Error {}

/**
 * Caso de uso «confirmar la recepción de una compra pendiente» (Compras N3-a, recepción separada; docs/diseno-compras-paridad-escalera-2026-11-16.md, CU-2): un gerente o administrador de la sucursal confirma que llegó la mercadería de una factura
 * cargada «pendiente de recibir» y elige, para cada renglón, la sección (depósito) donde entra (puede dividirlo entre varias: N3-b) y la fecha de stock. Recién acá entran su stock, su costo y su gasto: la compra (`Operacion` COMPRA + una línea del
 * Kardex por entrada, con su renglón) se escribe como la escribe «cargar factura» cuando el módulo está apagado. El control por línea (conforme, con observaciones, rechazada; `registrar-control-de-recepcion.ts`) NO cambia cuánto stock entra: una línea
 * RECHAZADA entra igual, en la sección que elige quien recibe (decisión 2026-11-16: todavía no hay depósito de rechazo).
 *
 * `import "server-only"` y SIN `"use server"`: no chequea permisos (la Server Action pidió `compra_recibir` en la sucursal activa: del módulo `recepcion_de_compras`, piso administrador) ni el formato (`guardComandoConfirmarRecepcionDeFactura`).
 *
 * En UNA transacción SERIALIZABLE:
 *  1. `SELECT … FOR UPDATE` de la cabecera de la factura (serializa contra la anulación y contra otra confirmación); no existe en la empresa (la RLS esconde las ajenas) → «no se encontró»;
 *  2. `decidirConfirmacionDeRecepcion` (regla pura, contrastada con el oráculo): la parte es de esta sucursal, la factura no está anulada, la parte sigue pendiente, cada sección es de esta sucursal y está activa, y la fecha de stock está
 *     entre la fecha de la factura y hoy (días en hora argentina); `validarEntradasDeRecepcion`: por cada renglón la SUMA de sus entradas es EXACTAMENTE su cantidad (diferencia declarada con Pedernal, donde es menor o igual: acá no hay otra
 *     cantidad recibida); cada producto sigue habilitado en esta sucursal;
 *  3. arma una línea del Kardex por entrada desde los renglones guardados (el precio TOTAL del renglón se reparte en proporción exacta a la cantidad; el precio por unidad, el lote y el detalle, TAL CUAL), escribe la compra y marca la parte RECIBIDA con su compra, con `WHERE estado = 'PENDIENTE'`:
 *     si no tocó ninguna fila, ganó otra confirmación y se deshace todo (no queda compra huérfana); la segunda barrera es el disparador de la base (una parte recibida no vuelve atrás);
 *  4. audita (`FacturaProveedor`, campo `recepcion`, de PENDIENTE a RECIBIDA: quién (`actorId`), cuándo (el registro) y, en la descripción, las secciones y la fecha de stock).
 * Compras, orden de compra (etapa OC): si los renglones de la compra están vinculados a líneas de una orden, al pasar la parte a RECIBIDA un disparador de la base suma lo recibido (sin los renglones que el control dejó RECHAZADOS) al saldo de cada línea, con UN UPDATE
 * condicionado cuyo tope sale del nivel del control `compras.recepcion_excede_la_orden` (sin fila = PERMITIR) y de `confirmoExceso`; si el tope frena, se deshace TODO (compra, stock y estado) y la respuesta dice por qué (`EXCEDE_LA_ORDEN_*`).
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
    // Cada sección elegida: de esta sucursal y activa. El estado que decide la regla es el PEOR de todas (ajena, después inactiva): así una sola regla pura cubre una o varias secciones.
    const seccionesPorId = new Map<string, Awaited<ReturnType<typeof obtenerSeccionPropia>>>();
    for (const id of new Set(comando.entradas.map((e) => e.seccionId))) seccionesPorId.set(id, await obtenerSeccionPropia(id, actor.sucursalId, tx));
    const secciones = [...seccionesPorId.values()];
    const inactiva = secciones.find((s) => s && !s.activa);
    const estadoDeLaSeccion: SeccionParaRecibir = secciones.some((s) => !s) ? "AJENA" : inactiva ? "INACTIVA" : "PROPIA_ACTIVA";
    const diaFactura = diaDeCalendario(factura.fecha, ZONA_ARGENTINA);
    const diaStock = diaDeCalendario(comando.fechaStock, ZONA_ARGENTINA);
    const hoy = diaDeCalendario(actor.ahora, ZONA_ARGENTINA);
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
      if (decision.codigo === "SECCION_INACTIVA") return fracaso("SECCION_INACTIVA", mensajeSeccionDesactivada(inactiva?.nombre ?? ""));
      return fracaso(decision.codigo, decision.mensaje);
    }
    // La regla ya garantizó la parte y las secciones; esto solo lo deja claro para el compilador.
    if (!parte) return fracaso("NO_ENCONTRADA", MENSAJE_RECEPCION_NO_ENCONTRADA);

    const renglones = await cargarRenglonesParaRecibir(tx, factura.id);
    if (!renglones.length) return fracaso("SIN_LINEAS", "La compra no tiene mercadería para recibir.");
    // Las entradas: cada renglón de mercadería entra en una o varias secciones y la suma de sus entradas es EXACTAMENTE su cantidad.
    const entradasValidas = validarEntradasDeRecepcion(
      renglones.map((r) => ({ renglonId: r.facturaProveedorRenglonId, cantidad: r.cantidadStock, decimales: r.decimalesDeLaUnidad })),
      comando.entradas
    );
    if (!entradasValidas.ok) return fracaso(entradasValidas.codigo, entradasValidas.mensaje);
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
    // UNA línea del Kardex por entrada, en el orden de los renglones y de las entradas. El precio TOTAL del renglón se reparte en proporción exacta a la cantidad de cada entrada (la suma da el precio del renglón al centavo); el precio por unidad
    // de stock, el lote y el detalle son los del renglón en todas. La condición del control (conforme, con observaciones, rechazada) NO cambia cuánto stock entra.
    const lineas = renglones.flatMap((r) => {
      const deEsteRenglon = comando.entradas.filter((e) => e.renglonId === r.facturaProveedorRenglonId);
      const precios = prorratearPrecioDeRenglon(r.precioTotal, deEsteRenglon.map((e) => e.cantidad));
      return deEsteRenglon.map((e, i) => ({
        operacionId: operacion.id,
        productoId: r.productoId,
        seccionId: e.seccionId,
        proceso: "COMPRA" as const,
        cantidad: e.cantidad,
        loteVencimiento: r.loteVencimiento,
        detalle: r.detalle,
        precioTotal: precios[i] ?? 0,
        precioPorUnidadStock: r.precioPorUnidadStock,
        facturaProveedorRenglonId: r.facturaProveedorRenglonId,
      }));
    });
    const escritas = await escribirLineasDeMovimientoStock(tx, lineas);
    const confirmadas = await confirmarParteRecibida(tx, { parteId: parte.id, operacionId: operacion.id, recibidaEn: comando.fechaStock, recibidaPorId: actor.usuarioId });
    if (confirmadas !== 1) throw new ParteYaRecibida();

    await registrarCambioAuditado(tx, {
      entidad: "FacturaProveedor",
      entidadId: factura.id,
      descripcion: `Recepción de la compra${factura.nroFactura ? ` ${factura.nroFactura}` : ""} confirmada en «${actor.sucursalNombre}» (${secciones.length === 1 ? `sección «${secciones[0]?.nombre ?? ""}»` : `secciones ${secciones.map((x) => `«${x?.nombre ?? ""}»`).join(", ")}`}, fecha de stock ${diaStock})`,
      campo: "recepcion",
      valorAnterior: "PENDIENTE",
      valorNuevo: "RECIBIDA",
      actorId: actor.usuarioId,
      sucursalId: actor.sucursalId,
    });

    return exito(`Recepción confirmada: ${escritas.movimientos} movimiento(s) entraron al stock de esta sucursal con fecha ${diaStock}.`, { operacionId: operacion.id, movimientos: escritas.movimientos });
  }).catch((e): ResultadoConfirmarRecepcionDeFactura => {
    if (e instanceof ParteYaRecibida) return fracaso("YA_RECIBIDA", MENSAJE_RECEPCION_YA_RECIBIDA);
    // Compras, orden de compra (etapa OC): confirmar suma lo recibido al saldo de la línea de la orden con el tope en el WHERE (disparador de la base); si el control de exceso lo frena, la transacción entera se deshace (no queda stock ni compra) y se dice por qué.
    const deLaOrden = rechazoDeOrdenDeLaBase(e);
    if (deLaOrden) return fracaso(deLaOrden.codigo, deLaOrden.mensaje);
    throw e;
  });
}
