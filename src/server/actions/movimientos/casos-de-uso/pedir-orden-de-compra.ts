import "server-only";
import { decidirPedirOrden, MENSAJE_ORDEN_NO_ENCONTRADA, type EstadoDeOrden } from "@/core/compras/public";
import type { ComandoDeOrdenDeCompra, ResultadoPedirOrdenDeCompra } from "@/core/features/compras/orden-de-compra.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { ZONA_ARGENTINA, diaDeCalendario, diaDeColumnaDate, fechaDeColumnaDate } from "@/core/tiempo/zona-horaria";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { bloquearOrden, contarLineasNoRetiradas } from "@/server/persistencia/compras/cargar-orden-de-compra";
import { marcarOrdenPedida } from "@/server/persistencia/compras/escribir-orden-de-compra";

/**
 * Caso de uso «pedir una orden de compra» (Compras, etapa OC): un gerente o administrador pasa la orden de BORRADOR a PEDIDA. Sin segunda aprobación (decisión del dueño de Pedernal, 2026-11-16: una orden NO necesita aprobación). Desde ese momento la orden
 * tiene su número correlativo por empresa, nace el saldo de cada línea (lo recibido contra lo pedido) y no se edita más; recién entonces se puede cargar una compra contra ella.
 *
 * `import "server-only"` y SIN `"use server"`: no chequea permisos (la Server Action pidió `orden_de_compra_gestionar`) ni el formato (`guardComandoDeOrdenDeCompra`).
 *
 * En UNA transacción SERIALIZABLE:
 *  1. `SELECT … FOR UPDATE` de la cabecera (serializa contra otro pedir, contra anular y contra el registro de un vínculo); no existe o no se ve → «no se encontró»;
 *  2. `decidirPedirOrden` (regla pura): borrador, con al menos una línea que no se retiró y la entrega prevista no anterior a hoy (día argentino del reloj inyectado). Pedir dos veces da «ya pedida», sin otro número;
 *  3. UPDATE con la guarda `estado = 'BORRADOR'` (quién, cuándo y la jornada; el NÚMERO lo fija la base bajo un candado por empresa, max+1, único por empresa: dos pedidos a la vez no repiten número) y, en la base, nace el saldo de cada línea;
 *  4. lee el número asignado y audita (`OrdenDeCompra`, campo `estado`, de BORRADOR a PEDIDA, con el número en la descripción).
 *
 * @contract Pasa la orden de BORRADOR a PEDIDA exactamente una vez, con un número único en la empresa, o no hace nada.
 * @idempotency POR_ESTADO: la guarda `estado = 'BORRADOR'` y el candado de la cabecera; el segundo pedido recibe «ya pedida».
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento, también ante el choque del número único: el perdedor repite y toma el siguiente), con candado sobre la cabecera de la orden.
 * @sideEffects registrarCambioAuditado (la orden pedida).
 * @ficha permiso=orden_de_compra_gestionar transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function pedirOrdenDeCompraCasoDeUso(
  actor: Pick<ContextoDeAccion, "usuarioId" | "sucursalId" | "db" | "transaccion" | "ahora">,
  comando: ComandoDeOrdenDeCompra
): Promise<ResultadoPedirOrdenDeCompra> {
  const hoy = diaDeCalendario(actor.ahora, ZONA_ARGENTINA);
  return conTransaccionSerializable(actor.transaccion, async (tx): Promise<ResultadoPedirOrdenDeCompra> => {
    const orden = await bloquearOrden(tx, comando.ordenId);
    if (!orden) return fracaso("NO_ENCONTRADA", MENSAJE_ORDEN_NO_ENCONTRADA);
    const decision = decidirPedirOrden({
      estado: orden.estado as EstadoDeOrden,
      lineasNoRetiradas: await contarLineasNoRetiradas(tx, orden.id),
      fechaDeEntregaPrevista: orden.fechaDeEntregaPrevista ? diaDeColumnaDate(orden.fechaDeEntregaPrevista) : null,
      hoy,
    });
    if (!decision.ok) return fracaso(decision.codigo, decision.mensaje);
    const tocadas = await marcarOrdenPedida(tx, { ordenId: orden.id, usuarioId: actor.usuarioId, ahora: actor.ahora, fechaDeNegocio: fechaDeColumnaDate(hoy) });
    if (tocadas !== 1) return fracaso("YA_PEDIDA", "Esta orden ya fue pedida.");
    const pedida = await tx.ordenDeCompra.findUnique({ where: { id: orden.id }, select: { numero: true } });
    if (!pedida?.numero) throw new Error("pedirOrdenDeCompra: la base no asignó el número de la orden.");
    await registrarCambioAuditado(tx, {
      entidad: "OrdenDeCompra",
      entidadId: orden.id,
      descripcion: `Orden de compra pedida con el número ${pedida.numero}`,
      campo: "estado",
      valorAnterior: "BORRADOR",
      valorNuevo: "PEDIDA",
      actorId: actor.usuarioId,
      sucursalId: actor.sucursalId,
    });
    return exito(`Orden pedida: es la número ${pedida.numero}.`, { ordenId: orden.id, numero: pedida.numero });
  }, undefined, undefined, true);
}
