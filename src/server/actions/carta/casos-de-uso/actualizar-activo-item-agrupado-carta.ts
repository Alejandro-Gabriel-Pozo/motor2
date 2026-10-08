import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { whereCartaDeSucursal } from "@/core/carta/public";
import type { ComandoActualizarActivoItemAgrupadoCarta, ResultadoActualizarActivoItemAgrupadoCarta } from "@/core/features/carta/items-agrupados.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { fijarActivoDeItemAgrupadoCarta } from "@/server/persistencia/carta/items-agrupados";

/**
 * Caso de uso «apagar o prender un ítem agrupado de la carta» (docs/plan-agrupacion-items-carta-2026-09-24.md, M5; Hito 5, bloque D, `docs/plan-hito-5-pureza.md` §6.1). Es
 * el cuerpo que antes vivía en línea en la Server Action `actualizarActivoItemAgrupadoCarta` (`src/server/actions/carta/items-agrupados.ts`), movido TAL CUAL: la lectura
 * y la escritura con la base del contexto, sin transacción ni auditoría (el estado prendido/apagado no es plata). Nunca se borra un ítem agrupado: apagado deja de salir
 * en la carta, y sus opciones tampoco salen sueltas (D3). La Server Action quedó como adaptador (`conPermisoDeEmpresa("carta_items_agrupados")` → este caso de uso →
 * `revalidarCartasPublicas` si salió bien → `aResultadoAccion`).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos. Los ítems agrupados son PROPIOS de cada sucursal (ADR-009, C3): la lectura mira
 * solo la sucursal activa (`whereCartaDeSucursal`). Un id que no es texto hace lanzar a Prisma en la lectura, como antes (sin guard).
 *
 * @contract Deja el ítem agrupado de la sucursal activa prendido o apagado; el mensaje nombra el ítem y lo que se hizo.
 * @idempotency No aplica — repetir el pedido vuelve a escribir el mismo estado.
 * @transaction Ninguna: una lectura y una escritura con `actor.db`, como antes.
 * @sideEffects Ninguno (sin auditoría). La revalidación de la carta pública la hace la Server Action cuando sale bien.
 * @ficha permiso=carta_items_agrupados transaccion=NINGUNA idempotencia=NO_APLICA auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function actualizarActivoItemAgrupadoCartaCasoDeUso(
  actor: Pick<ContextoUsuario, "db" | "sucursalId">,
  comando: ComandoActualizarActivoItemAgrupadoCarta,
): Promise<ResultadoActualizarActivoItemAgrupadoCarta> {
  const { itemAgrupadoCartaId, activo } = comando;
  const existente = await actor.db.itemAgrupadoCarta.findUnique({ where: { id: itemAgrupadoCartaId, ...whereCartaDeSucursal(actor.sucursalId) } });
  if (!existente) return fracaso("ITEM_NO_ENCONTRADO", "No se encontró el ítem agrupado.");
  await fijarActivoDeItemAgrupadoCarta(actor.db, { id: itemAgrupadoCartaId, activo });
  return exito(`Ítem agrupado "${existente.nombre}" ${activo ? "prendido" : "apagado"}.`, null);
}
