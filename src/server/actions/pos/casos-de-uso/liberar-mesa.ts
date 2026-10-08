import "server-only";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import type { ComandoLiberarMesa, ResultadoLiberarMesa } from "@/core/features/cuentas/cuenta-apertura.schema";
import { conTransaccionSerializable } from "@/core/movimientos/public-servidor";
import { exito, fracaso } from "@/core/resultado-caso";
import { marcarCuentaCerrada } from "@/server/persistencia/pos/cerrar-cuenta";
import { cuentaAbiertaDeSucursal } from "../cuenta-comun";

/**
 * Caso de uso «liberar una mesa sin venta» (Hito 4 de la pureza, bloque 4.1, paso 5 — `docs/plan-hito-4-pureza.md` §5). Es el cuerpo que antes vivía en línea
 * en la Server Action `liberarMesa` (`src/server/actions/pos/cuenta-apertura.ts`), movido TAL CUAL: las mismas lecturas, en el mismo orden, dentro de la misma
 * transacción SERIALIZABLE, y los mismos mensajes. La Server Action quedó como adaptador (`conPermiso("pos_liberar_mesa")` → `guardComandoLiberarMesa` → este
 * caso de uso → `aResultadoAccion`). El criterio de negocio (solo una cuenta SIN NINGUNA fila; con cualquier fila se cierra con `cerrarCuenta`) está
 * documentado en la Server Action.
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos (`conPermiso`) ni que el id sea un texto (el guard).
 *
 * En UNA transacción SERIALIZABLE (`conTransaccionSerializable`, con reintento ante un conflicto de escritura): 1. la cuenta, de una mesa de ESTA sucursal y
 * abierta (`cuentaAbiertaDeSucursal`, de `../cuenta-comun.ts` hasta que migren las acciones de pedido que también la usan); 2. que no tenga ninguna fila; 3. el
 * cierre (`marcarCuentaCerrada`, la MISMA escritura que el cierre de `cerrarCuenta`: server/persistencia/pos/cerrar-cuenta.ts) con la hora del pedido
 * (`actor.ahora`, aprobado por el dueño en el Hito 4: antes leía el reloj).
 *
 * @contract Cierra sin venta la cuenta abierta de una mesa de la sucursal que no tiene ninguna fila: la mesa queda libre.
 * @idempotency Por estado — un segundo intento ve la cuenta ya cerrada y responde «ya está cerrada» sin escribir (la transacción serializable arbitra el doble clic).
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento).
 * @sideEffects Ninguno (la cuenta es su propio documento: queda con quién la cerró y cuándo). Refrescar la vista lo hace el cliente (`router.refresh()`).
 * @ficha permiso=pos_liberar_mesa transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function liberarMesaCasoDeUso(
  actor: Pick<ContextoDeAccion, "usuarioId" | "sucursalId" | "transaccion" | "ahora">,
  comando: ComandoLiberarMesa,
): Promise<ResultadoLiberarMesa> {
  return conTransaccionSerializable(actor.transaccion, async (tx): Promise<ResultadoLiberarMesa> => {
    const abierta = await cuentaAbiertaDeSucursal(tx, comando.cuentaId, actor.sucursalId);
    if (!abierta.ok) return fracaso("CUENTA_NO_ABIERTA", abierta.mensaje);
    if ((await tx.cuentaItem.count({ where: { cuentaId: abierta.cuenta.id } })) > 0) {
      return fracaso("CON_ITEMS", `La cuenta de la mesa ${abierta.cuenta.mesa.numero} tiene ítems cargados: cerrá la cuenta en vez de liberar la mesa.`);
    }
    await marcarCuentaCerrada(tx, { cuentaId: abierta.cuenta.id, cerradaEn: actor.ahora, cerradaPorId: actor.usuarioId });
    return exito(`Mesa ${abierta.cuenta.mesa.numero} liberada.`, null);
  });
}
