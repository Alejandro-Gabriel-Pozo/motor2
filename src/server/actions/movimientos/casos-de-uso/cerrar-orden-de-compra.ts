import "server-only";
import { decidirCerrarOrden, MENSAJE_ORDEN_NO_ENCONTRADA, type EstadoDeOrden, type MotivoDeCierre } from "@/core/compras/public";
import type { ComandoDeOrdenDeCompra, ResultadoCerrarOrdenDeCompra } from "@/core/features/compras/orden-de-compra.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import { conEscrituraEnLaEmpresa } from "@/server/acceso/alcance";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { bloquearOrden, hayCompraContraLaOrden } from "@/server/persistencia/movimientos/cargar-orden-de-compra";
import { marcarOrdenCerrada } from "@/server/persistencia/movimientos/escribir-orden-de-compra";

/**
 * Caso de uso «cerrar una orden de compra» (Compras, etapa OC): un gerente o administrador cierra A MANO una orden pedida (como Pedernal: no hay cierre automático al recibir todo). Se cierra solo si no hay compras pendientes de recibir contra ella. La base fija
 * el motivo del cierre: COMPLETA si todas las líneas llegaron a lo pedido, CON_SALDO si no. Una orden cerrada no se reabre.
 *
 * `import "server-only"` y SIN `"use server"`: no chequea permisos (la Server Action pidió `orden_de_compra_gestionar`) ni el formato (`guardComandoDeOrdenDeCompra`).
 *
 * En UNA transacción SERIALIZABLE abierta con la base de VERIFICACIÓN (lectura en toda la empresa, escritura como estaba; devuelve solo un sí/no de si hay compras pendientes contra la orden en ALGUNA sucursal):
 *  1. `SELECT … FOR UPDATE` de la cabecera; no existe o no se ve → «no se encontró»;
 *  2. `decidirCerrarOrden` (regla pura): ya cerrada → anulada → no pedida (un borrador se anula, no se cierra) → compras pendientes. Cerrar dos veces da «ya cerrada»;
 *  3. UPDATE con la guarda `estado = 'PEDIDA'`, lee el motivo de cierre que fijó la base y audita (`OrdenDeCompra`, campo `estado`, de PEDIDA a CERRADA con el motivo en la descripción).
 *
 * @contract Cierra la orden pedida exactamente una vez, sin compras pendientes de recibir, con su motivo de cierre calculado por la base, o no hace nada.
 * @idempotency POR_ESTADO: la guarda `estado = 'PEDIDA'` y el candado de la cabecera; el segundo cierre recibe «ya cerrada».
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento) con la base ampliada a la empresa (`conEscrituraEnLaEmpresa`), con candado sobre la cabecera de la orden.
 * @sideEffects registrarCambioAuditado (el cierre).
 * @ficha permiso=orden_de_compra_gestionar transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function cerrarOrdenDeCompraCasoDeUso(
  actor: Pick<ContextoDeAccion, "usuarioId" | "sucursalId" | "db" | "transaccion" | "empresaId" | "alcance" | "ahora">,
  comando: ComandoDeOrdenDeCompra
): Promise<ResultadoCerrarOrdenDeCompra> {
  // La orden es un documento de la EMPRESA (`EMPRESA_ENTERA`): quien la gestiona la ve y la escribe aunque esté destinada a otra sucursal, y la pregunta «¿hay compras contra ella?» mira todas las sucursales.
  const base = await conEscrituraEnLaEmpresa(actor);
  return conTransaccionSerializable(base.transaccion, async (tx): Promise<ResultadoCerrarOrdenDeCompra> => {
    const orden = await bloquearOrden(tx, comando.ordenId);
    if (!orden) return fracaso("NO_ENCONTRADA", MENSAJE_ORDEN_NO_ENCONTRADA);
    const decision = decidirCerrarOrden({ estado: orden.estado as EstadoDeOrden, hayRecepcionesPendientes: await hayCompraContraLaOrden(tx, orden.id, true) });
    if (!decision.ok) return fracaso(decision.codigo, decision.mensaje);
    const tocadas = await marcarOrdenCerrada(tx, { ordenId: orden.id, usuarioId: actor.usuarioId, ahora: actor.ahora });
    if (tocadas !== 1) return fracaso("NO_ENCONTRADA", MENSAJE_ORDEN_NO_ENCONTRADA);
    const cerrada = await tx.ordenDeCompra.findUnique({ where: { id: orden.id }, select: { cierreMotivo: true } });
    const cierreMotivo = cerrada?.cierreMotivo as MotivoDeCierre | null | undefined;
    if (!cierreMotivo) throw new Error("cerrarOrdenDeCompra: la base no fijó el motivo del cierre.");
    await registrarCambioAuditado(tx, {
      entidad: "OrdenDeCompra",
      entidadId: orden.id,
      descripcion: `Orden de compra${orden.numero ? ` ${orden.numero}` : ""} cerrada (${cierreMotivo === "COMPLETA" ? "completa" : "con saldo"})`,
      campo: "estado",
      valorAnterior: "PEDIDA",
      valorNuevo: "CERRADA",
      actorId: actor.usuarioId,
      sucursalId: actor.sucursalId,
    });
    return exito(cierreMotivo === "COMPLETA" ? "Orden cerrada: se recibió todo lo pedido." : "Orden cerrada con saldo: quedó mercadería sin recibir.", { ordenId: orden.id, cierreMotivo });
  }, undefined, undefined, true);
}
