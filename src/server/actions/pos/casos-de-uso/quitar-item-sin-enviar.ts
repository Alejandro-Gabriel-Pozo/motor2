import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { MENSAJE_ITEM_NO_ENCONTRADO } from "@/core/features/cuentas/cuenta-anulacion.guard";
import type { ComandoQuitarItemSinEnviar, ResultadoQuitarItemSinEnviar } from "@/core/features/cuentas/cuenta-pedido.schema";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import { exito, fracaso } from "@/core/resultado-caso";
import { borrarItemSinEnviar } from "@/server/persistencia/pos/pedido";
import { cuentaAbiertaDeSucursal } from "@/server/persistencia/pos/cargar-cuenta-abierta";

/**
 * Caso de uso «quitar un ítem que todavía no salió a cocina» (Hito 4 de la pureza, bloque 4.1, paso 9 — `docs/plan-hito-4-pureza.md` §5). Es el cuerpo que
 * antes vivía en línea en la Server Action `quitarItemSinEnviar` (`src/server/actions/pos/cuenta-pedido.ts`), movido TAL CUAL: las mismas lecturas, en el
 * mismo orden, dentro de la misma transacción SERIALIZABLE, y los mismos mensajes. La Server Action quedó como adaptador (`conPermiso("pos_tomar_pedido")` →
 * `guardComandoQuitarItemSinEnviar` → este caso de uso → `aResultadoAccion`). El criterio de negocio (un ítem sin enviar es un borrador: se borra de verdad,
 * sin motivo ni auditoría; uno ya enviado se anula con motivo) está documentado en la Server Action.
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos (`conPermiso`) ni que el id sea un texto (el guard).
 *
 * En UNA transacción SERIALIZABLE (`conTransaccionSerializable`, con reintento ante un conflicto de escritura): 1. el ítem, de una mesa de ESTA sucursal, con el
 * nombre de su producto y el título de su promo; 2. que no sea el componente de una promo (Task #16, D4: la promo se quita entera); 3. su cuenta, abierta
 * (`cuentaAbiertaDeSucursal`, server/persistencia/pos/cargar-cuenta-abierta.ts); 4. el borrado CONDICIONAL (`borrarItemSinEnviar`, server/persistencia/pos/pedido.ts: la condición
 * `numeroEnvio: null` vive en el mismo DELETE): si no borró nada, el ítem ya había salido a cocina.
 *
 * @contract Borra un ítem suelto de una cuenta abierta de la sucursal mientras no haya salido a cocina; nunca un componente de promo ni un ítem ya enviado.
 * @idempotency Por estado — un segundo intento ya no encuentra el ítem («No se encontró ese ítem») y no escribe; si otro mozo lo envió antes, el borrado condicional no borra nada.
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento).
 * @sideEffects Ninguno (sin auditoría: un borrador del POS, como antes). Refrescar la vista lo hace el cliente (`router.refresh()`).
 * @ficha permiso=pos_tomar_pedido transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function quitarItemSinEnviarCasoDeUso(
  actor: Pick<ContextoUsuario, "sucursalId" | "transaccion">,
  comando: ComandoQuitarItemSinEnviar,
): Promise<ResultadoQuitarItemSinEnviar> {
  return conTransaccionSerializable(actor.transaccion, async (tx): Promise<ResultadoQuitarItemSinEnviar> => {
    const item = await tx.cuentaItem.findFirst({
      where: { id: comando.cuentaItemId, cuenta: { mesa: { sucursalId: actor.sucursalId } } },
      include: { producto: { select: { nombre: true } }, promoCuenta: { select: { titulo: true } } },
    });
    if (!item) return fracaso("NO_ENCONTRADO", MENSAJE_ITEM_NO_ENCONTRADO);
    // Task #16 (D4, "una promo se anula/quita entera"): un componente no se quita suelto — usá quitarPromoSinEnviar con la promo.
    if (item.promoCuenta) return fracaso("COMPONENTE_DE_PROMO", `«${item.producto.nombre}» es parte de la promo «${item.promoCuenta.titulo}»: quitá la promo entera.`);
    const abierta = await cuentaAbiertaDeSucursal(tx, item.cuentaId, actor.sucursalId);
    if (!abierta.ok) return fracaso("CUENTA_NO_ABIERTA", abierta.mensaje);

    if ((await borrarItemSinEnviar(tx, { cuentaItemId: item.id })) === 0) return fracaso("YA_ENVIADO", "Ese ítem ya salió a cocina: anulalo con motivo.");
    return exito(`Se quitó «${item.producto.nombre}» de la mesa ${abierta.cuenta.mesa.numero}.`, null);
  });
}
