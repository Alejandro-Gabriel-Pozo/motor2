import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { whereCartaDeSucursal } from "@/core/carta/public";
import type { ComandoActualizarActivoGeneroCarta, ResultadoActualizarActivoGeneroCarta } from "@/core/features/carta/generos.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { fijarActivoDeGeneroCarta } from "@/server/persistencia/carta/generos";

/**
 * Caso de uso «apagar o prender un género de la carta» (docs/plan-genero-carta-2026-09-26.md; Hito 5, bloque D, `docs/plan-hito-5-pureza.md` §6.1). Es el cuerpo que
 * antes vivía en línea en la Server Action `actualizarActivoGeneroCarta` (`src/server/actions/carta/generos.ts`), movido TAL CUAL: la lectura (solo de la sucursal
 * activa) y la escritura con la base del contexto, sin transacción ni auditoría. Nunca se borra un género: se apaga (deja de mostrarse como carpeta; lo que tenía ese
 * género queda suelto, sin error). La Server Action quedó como adaptador (`conPermiso("carta_generos")` → este caso de uso → `revalidarCartasPublicas` si
 * salió bien → `aResultadoAccion`).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos. Un id que no es texto hace lanzar a Prisma en la lectura, como antes (sin guard).
 *
 * @contract Deja el género prendido o apagado en la sucursal activa; el mensaje nombra el género y lo que se hizo.
 * @idempotency No aplica — repetir el pedido vuelve a escribir el mismo estado.
 * @transaction Ninguna: una lectura y una escritura con `actor.db`, como antes.
 * @sideEffects Ninguno (sin auditoría). La revalidación de la carta pública la hace la Server Action cuando sale bien.
 * @ficha permiso=carta_generos transaccion=NINGUNA idempotencia=NO_APLICA auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function actualizarActivoGeneroCartaCasoDeUso(
  actor: Pick<ContextoUsuario, "db" | "sucursalId">,
  comando: ComandoActualizarActivoGeneroCarta,
): Promise<ResultadoActualizarActivoGeneroCarta> {
  const { generoCartaId, activo } = comando;
  const existente = await actor.db.generoCarta.findUnique({ where: { id: generoCartaId, ...whereCartaDeSucursal(actor.sucursalId) } });
  if (!existente) return fracaso("GENERO_NO_ENCONTRADO", "No se encontró el género.");
  await fijarActivoDeGeneroCarta(actor.db, { id: generoCartaId, activo });
  return exito(`Género "${existente.nombre}" ${activo ? "activado" : "desactivado"}.`, null);
}
