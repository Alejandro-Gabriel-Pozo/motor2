import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { MENSAJE_PROMO_NO_ENCONTRADA } from "@/core/features/cuentas/cuenta-anulacion.guard";
import type { ComandoQuitarPromoSinEnviar, ResultadoQuitarPromoSinEnviar } from "@/core/features/cuentas/cuenta-pedido.schema";
import { conTransaccionSerializable } from "@/core/movimientos/public-servidor";
import { exito, fracaso } from "@/core/resultado-caso";
import { borrarPromoSinEnviar } from "@/server/persistencia/pos/pedido";

/**
 * Caso de uso «quitar una promo entera que todavía no salió a cocina» (Hito 4 de la pureza, bloque 4.1, paso 10 — `docs/plan-hito-4-pureza.md` §5). Es el
 * cuerpo que antes vivía en línea en la Server Action `quitarPromoSinEnviar` (`src/server/actions/pos/cuenta-pedido.ts`), movido TAL CUAL: la misma lectura,
 * los mismos chequeos en el mismo orden, dentro de la misma transacción SERIALIZABLE, y los mismos mensajes. La Server Action quedó como adaptador
 * (`conPermiso("pos_tomar_pedido")` → `guardComandoQuitarPromoSinEnviar` → este caso de uso → `aResultadoAccion`). El criterio de negocio (Task #16, D4: la
 * promo se quita ENTERA; si algún componente ya salió, se anula con motivo) está documentado en la Server Action.
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos (`conPermiso`) ni que el id sea un texto (el guard).
 *
 * En UNA transacción SERIALIZABLE (`conTransaccionSerializable`, con reintento ante un conflicto de escritura): 1. la promo, de una mesa de ESTA sucursal, con su
 * cuenta (y el número de la mesa) y TODOS sus ítems; 2. que la cuenta siga abierta; 3. que ningún componente haya salido a cocina ni sea una fila espejo; 4. el
 * borrado (`borrarPromoSinEnviar`, server/persistencia/pos/pedido.ts): los componentes y DESPUÉS la promo, como antes.
 *
 * @contract Borra una promo de una cuenta abierta de la sucursal con todos sus componentes, mientras ninguno haya salido a cocina; nunca a medias.
 * @idempotency Por estado — un segundo intento ya no encuentra la promo («No se encontró esa promo») y no escribe.
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento).
 * @sideEffects Ninguno (sin auditoría: un borrador del POS, como antes). Refrescar la vista lo hace el cliente (`router.refresh()`).
 * @ficha permiso=pos_tomar_pedido transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function quitarPromoSinEnviarCasoDeUso(
  actor: Pick<ContextoUsuario, "sucursalId" | "transaccion">,
  comando: ComandoQuitarPromoSinEnviar,
): Promise<ResultadoQuitarPromoSinEnviar> {
  return conTransaccionSerializable(actor.transaccion, async (tx): Promise<ResultadoQuitarPromoSinEnviar> => {
    const promoCuenta = await tx.promoCuenta.findFirst({
      where: { id: comando.promoCuentaId, cuenta: { mesa: { sucursalId: actor.sucursalId } } },
      include: { cuenta: { include: { mesa: { select: { numero: true } } } }, items: true },
    });
    if (!promoCuenta) return fracaso("NO_ENCONTRADA", MENSAJE_PROMO_NO_ENCONTRADA);
    if (promoCuenta.cuenta.cerradaEn) return fracaso("CUENTA_CERRADA", `La cuenta de la mesa ${promoCuenta.cuenta.mesa.numero} ya está cerrada.`);
    if (promoCuenta.items.some((i) => i.numeroEnvio !== null || i.anulaAItemId !== null)) {
      return fracaso("YA_ENVIADA", "Esa promo ya salió a cocina: anulala con motivo.");
    }
    await borrarPromoSinEnviar(tx, { promoCuentaId: promoCuenta.id });
    return exito(`Se quitó «${promoCuenta.titulo}» de la mesa ${promoCuenta.cuenta.mesa.numero}.`, null);
  });
}
