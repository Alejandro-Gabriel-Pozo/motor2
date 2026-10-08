import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import type { ComandoEnviarACocina, ResultadoEnviarACocina } from "@/core/features/cuentas/cuenta-pedido.schema";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import { exito, fracaso } from "@/core/resultado-caso";
import { enviarItemsACocina } from "@/server/persistencia/pos/pedido";
import { cuentaAbiertaDeSucursal } from "@/server/persistencia/pos/cargar-cuenta-abierta";

/**
 * Caso de uso «enviar a cocina» (Hito 4 de la pureza, bloque 4.1, paso 11 — `docs/plan-hito-4-pureza.md` §5). Es el cuerpo que antes vivía en línea en la
 * Server Action `enviarACocina` (`src/server/actions/pos/cuenta-pedido.ts`), movido TAL CUAL: las mismas lecturas, en el mismo orden, dentro de la misma
 * transacción SERIALIZABLE, y los mismos mensajes. La Server Action quedó como adaptador (`conPermiso("pos_enviar_a_cocina")` → `guardComandoEnviarACocina` →
 * este caso de uso → `{ ...ok(mensaje), numeroEnvio, envioNuevo }`: no pasa por `aResultadoAccion` porque la pantalla necesita además el envío; está en
 * `SIN_ENVOLTORIO_TODAVIA` con su motivo). El criterio de negocio (KOT derivado de `numeroEnvio`, solo los ids que el mozo tenía en pantalla, una promo nunca
 * sale a medias) está documentado en la Server Action.
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos (`conPermiso`) ni el formato de la lista (el guard).
 *
 * En UNA transacción SERIALIZABLE (`conTransaccionSerializable`, con reintento ante un conflicto de escritura):
 *  1. la cuenta, de una mesa de ESTA sucursal y abierta (`cuentaAbiertaDeSucursal`, server/persistencia/pos/cargar-cuenta-abierta.ts);
 *  2. los hermanos: si algún id pedido es un componente de una promo, se suman TODOS los componentes de esa MISMA `PromoCuenta` que sigan sin enviar (Task #16,
 *     docs/plan-promo-combo-2026-09-26.md, D del paso 2.5: una promo nunca se manda parcial a cocina);
 *  3. el número de envío siguiente de la cuenta (`max(numeroEnvio) + 1`) y el envío CONDICIONAL (`enviarItemsACocina`, server/persistencia/pos/pedido.ts);
 *  4. si no cambió ninguna fila (doble clic, otro mozo se adelantó): no crea un envío vacío y responde el envío en el que ya habían salido, `envioNuevo: false`.
 *
 * @contract Pasa al envío siguiente de la cuenta los ítems pedidos (más los hermanos de sus promos) que sigan sin enviar; nunca crea un envío vacío.
 * @idempotency Por estado — el `UPDATE` es condicional (`numeroEnvio: null`): un segundo intento no cambia nada y responde el envío en el que ya salieron con `envioNuevo: false`.
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento).
 * @sideEffects Ninguno (sin auditoría: el envío queda en el propio ítem). Imprimir la comanda lo decide la pantalla con `envioNuevo`; refrescar la vista, el cliente.
 * @ficha permiso=pos_enviar_a_cocina transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function enviarACocinaCasoDeUso(
  actor: Pick<ContextoUsuario, "sucursalId" | "transaccion">,
  comando: ComandoEnviarACocina,
): Promise<ResultadoEnviarACocina> {
  const { itemIds } = comando;
  return conTransaccionSerializable(actor.transaccion, async (tx): Promise<ResultadoEnviarACocina> => {
    const abierta = await cuentaAbiertaDeSucursal(tx, comando.cuentaId, actor.sucursalId);
    if (!abierta.ok) return fracaso("CUENTA_NO_ABIERTA", abierta.mensaje);

    // Task #16 (docs/plan-promo-combo-2026-09-26.md, D del paso 2.5, "una promo nunca sale a medias"): si algún id pedido es
    // un componente de una promo, se suman TODOS los hermanos de esa MISMA PromoCuenta que sigan sin enviar — el mozo pudo
    // no tenerlos a todos en pantalla (o no haberlos tocado), pero una promo nunca se manda parcial a cocina.
    const pedidos = await tx.cuentaItem.findMany({ where: { id: { in: itemIds }, cuentaId: abierta.cuenta.id }, select: { promoCuentaId: true } });
    const promoCuentaIds = [...new Set(pedidos.flatMap((i) => (i.promoCuentaId ? [i.promoCuentaId] : [])))];
    const hermanos = promoCuentaIds.length
      ? await tx.cuentaItem.findMany({ where: { promoCuentaId: { in: promoCuentaIds }, cuentaId: abierta.cuenta.id, numeroEnvio: null, anulaAItemId: null }, select: { id: true } })
      : [];
    const idsAEnviar = [...new Set([...itemIds, ...hermanos.map((h) => h.id)])];

    const { _max } = await tx.cuentaItem.aggregate({ where: { cuentaId: abierta.cuenta.id }, _max: { numeroEnvio: true } });
    const numeroEnvio = (_max.numeroEnvio ?? 0) + 1;
    const enviados = await enviarItemsACocina(tx, { cuentaId: abierta.cuenta.id, itemIds: idsAEnviar, numeroEnvio });
    if (enviados === 0) {
      const previo = await tx.cuentaItem.aggregate({
        where: { id: { in: idsAEnviar }, cuentaId: abierta.cuenta.id, anulaAItemId: null, numeroEnvio: { not: null } },
        _max: { numeroEnvio: true },
      });
      return exito("Esos ítems ya estaban enviados.", { numeroEnvio: previo._max.numeroEnvio, envioNuevo: false });
    }
    return exito(`Envío ${numeroEnvio} a cocina: ${enviados === 1 ? "1 ítem" : `${enviados} ítems`} de la mesa ${abierta.cuenta.mesa.numero}.`, {
      numeroEnvio,
      envioNuevo: true,
    });
  });
}
