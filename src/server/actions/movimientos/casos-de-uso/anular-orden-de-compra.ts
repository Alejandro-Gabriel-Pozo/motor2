import "server-only";
import { decidirAnularOrden, MENSAJE_ORDEN_NO_ENCONTRADA, type EstadoDeOrden } from "@/core/compras/public";
import type { ComandoAnularOrdenDeCompra, ResultadoAnularOrdenDeCompra } from "@/core/features/compras/orden-de-compra.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import { conEscrituraEnLaEmpresa } from "@/server/acceso/alcance";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { bloquearOrden, hayCompraContraLaOrden } from "@/server/persistencia/movimientos/cargar-orden-de-compra";
import { marcarOrdenAnulada } from "@/server/persistencia/movimientos/escribir-orden-de-compra";

/**
 * Caso de uso «anular una orden de compra» (Compras, etapa OC): un gerente o administrador anula la orden (BORRADOR o PEDIDA) con un motivo obligatorio. Se anula solo si NO tiene compras vigentes cargadas contra ella (pendientes de recibir o ya recibidas,
 * de facturas no anuladas): primero se anulan esas compras. Una orden anulada o cerrada no se reabre ni se reemplaza (como Pedernal).
 *
 * `import "server-only"` y SIN `"use server"`: no chequea permisos (la Server Action pidió `orden_de_compra_gestionar`) ni el formato (`guardComandoAnularOrdenDeCompra`: el motivo ya viene en su forma canónica).
 *
 * En UNA transacción SERIALIZABLE abierta con la base de VERIFICACIÓN (lectura en toda la empresa, escritura como estaba): la pregunta «¿hay compras vigentes contra la orden en ALGUNA sucursal?» no puede depender de la sucursal activa (el vínculo es de la
 * sucursal de su compra) y devuelve solo un sí/no:
 *  1. `SELECT … FOR UPDATE` de la cabecera (serializa contra pedir, cerrar y el registro de un vínculo, que toma la orden `FOR SHARE`); no existe o no se ve → «no se encontró»;
 *  2. `decidirAnularOrden` (regla pura): ya anulada → cerrada (final) → compras vigentes → motivo. Anular dos veces da «ya anulada», sin escribir nada;
 *  3. UPDATE con la guarda de estado (BORRADOR o PEDIDA) y audita (`OrdenDeCompra`, campo `estado`, con el motivo en la descripción). La base repite la regla de las compras vigentes (disparador).
 *
 * @contract Anula la orden exactamente una vez, con su motivo y sin compras vigentes contra ella, o no hace nada.
 * @idempotency POR_ESTADO: la guarda `estado IN ('BORRADOR','PEDIDA')` y el candado de la cabecera; la segunda anulación recibe «ya anulada».
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento) con la base ampliada a la empresa (`conEscrituraEnLaEmpresa`), con candado sobre la cabecera de la orden.
 * @sideEffects registrarCambioAuditado (la anulación, con el motivo).
 * @ficha permiso=orden_de_compra_gestionar transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function anularOrdenDeCompraCasoDeUso(
  actor: Pick<ContextoDeAccion, "usuarioId" | "sucursalId" | "db" | "transaccion" | "empresaId" | "alcance" | "ahora">,
  comando: ComandoAnularOrdenDeCompra
): Promise<ResultadoAnularOrdenDeCompra> {
  // La orden es un documento de la EMPRESA (`EMPRESA_ENTERA`): quien la gestiona la ve y la escribe aunque esté destinada a otra sucursal, y la pregunta «¿hay compras contra ella?» mira todas las sucursales.
  const base = await conEscrituraEnLaEmpresa(actor);
  return conTransaccionSerializable(base.transaccion, async (tx): Promise<ResultadoAnularOrdenDeCompra> => {
    const orden = await bloquearOrden(tx, comando.ordenId);
    if (!orden) return fracaso("NO_ENCONTRADA", MENSAJE_ORDEN_NO_ENCONTRADA);
    const decision = decidirAnularOrden({
      estado: orden.estado as EstadoDeOrden,
      hayRecepcionesVigentes: await hayCompraContraLaOrden(tx, orden.id, false),
      motivo: comando.motivo,
    });
    if (!decision.ok) return fracaso(decision.codigo, decision.mensaje);
    const tocadas = await marcarOrdenAnulada(tx, { ordenId: orden.id, usuarioId: actor.usuarioId, ahora: actor.ahora, motivo: comando.motivo });
    if (tocadas !== 1) return fracaso("NO_ENCONTRADA", MENSAJE_ORDEN_NO_ENCONTRADA);
    await registrarCambioAuditado(tx, {
      entidad: "OrdenDeCompra",
      entidadId: orden.id,
      descripcion: `Orden de compra${orden.numero ? ` ${orden.numero}` : ""} anulada. Motivo: ${comando.motivo}`,
      campo: "estado",
      valorAnterior: orden.estado,
      valorNuevo: "ANULADA",
      actorId: actor.usuarioId,
      sucursalId: actor.sucursalId,
    });
    return exito("Orden anulada.", { ordenId: orden.id });
  }, undefined, undefined, true);
}
