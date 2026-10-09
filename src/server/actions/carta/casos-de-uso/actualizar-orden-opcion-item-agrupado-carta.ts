import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { whereCartaDeSucursal } from "@/core/carta/public";
import type { ComandoActualizarOrdenOpcionItemAgrupadoCarta, ResultadoActualizarOrdenOpcionItemAgrupadoCarta } from "@/core/features/carta/items-agrupados.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { cambiarOrdenDeOpcionDeItemAgrupado } from "@/server/persistencia/carta/items-agrupados";

/**
 * Caso de uso «cambiar el orden de una opción de un ítem agrupado» (docs/plan-agrupacion-items-carta-2026-09-24.md, M5; Hito 5, bloque D, `docs/plan-hito-5-pureza.md`
 * §6.1). Es el cuerpo que antes vivía en línea en la Server Action `actualizarOrdenOpcionItemAgrupadoCarta` (`src/server/actions/carta/items-agrupados.ts`), movido TAL
 * CUAL: una lectura y una escritura con la base del contexto, sin transacción ni auditoría. La Server Action quedó como adaptador
 * (`conPermiso("carta_items_agrupados")` → `guardComandoActualizarOrdenOpcionItemAgrupadoCarta` → este caso de uso → `revalidarCartasPublicas` si salió bien →
 * `aResultadoAccion`).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos ni el formato del orden (el guard, antes de leer). Las opciones son PROPIAS de
 * cada sucursal (ADR-009, C3): la lectura mira solo la sucursal activa (`whereCartaDeSucursal`).
 *
 * @contract Deja la opción de la sucursal activa con el orden pedido; el mensaje nombra el producto.
 * @idempotency No aplica — repetir el pedido vuelve a escribir el mismo valor.
 * @transaction Ninguna: una lectura y una escritura con `actor.db`, como antes.
 * @sideEffects Ninguno (sin auditoría). La revalidación de la carta pública la hace la Server Action cuando sale bien.
 * @ficha permiso=carta_items_agrupados transaccion=NINGUNA idempotencia=NO_APLICA auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function actualizarOrdenOpcionItemAgrupadoCartaCasoDeUso(
  actor: Pick<ContextoUsuario, "db" | "sucursalId">,
  comando: ComandoActualizarOrdenOpcionItemAgrupadoCarta,
): Promise<ResultadoActualizarOrdenOpcionItemAgrupadoCarta> {
  const { opcionId, orden } = comando;
  const opcion = await actor.db.opcionItemAgrupadoCarta.findUnique({ where: { id: opcionId, ...whereCartaDeSucursal(actor.sucursalId) }, select: { producto: { select: { nombre: true } } } });
  if (!opcion) return fracaso("OPCION_NO_ENCONTRADA", "No se encontró la opción.");
  await cambiarOrdenDeOpcionDeItemAgrupado(actor.db, { id: opcionId, orden });
  return exito(`Orden de «${opcion.producto.nombre}» guardado.`, null);
}
