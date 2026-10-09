import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import type { ComandoActualizarActivaSeccionCarta, ResultadoActualizarActivaSeccionCarta } from "@/core/features/carta/secciones.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { fijarActivaDeSeccionCarta } from "@/server/persistencia/carta/secciones";

/**
 * Caso de uso «apagar o prender una sección de la carta» (Hito 5, bloque D, `docs/plan-hito-5-pureza.md` §6.1). Es el cuerpo que antes vivía en línea en la Server Action
 * `actualizarActivaSeccionCarta` (`src/server/actions/carta/secciones.ts`), movido TAL CUAL: la lectura y la escritura con la base del contexto, sin transacción ni
 * auditoría (el estado prendido/apagado no es plata). Nunca se borra una sección: apagada deja de salir en la carta con todo lo suyo y se puede volver a prender. La
 * Server Action quedó como adaptador (`conPermisoDeEmpresa("carta_secciones")` → este caso de uso → `revalidarCartasPublicas` si salió bien → `aResultadoAccion`).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos. Un id que no es texto hace lanzar a Prisma en la lectura, como antes (sin guard).
 *
 * @contract Deja la sección prendida o apagada en la empresa; el mensaje nombra la sección y lo que se hizo.
 * @idempotency No aplica — repetir el pedido vuelve a escribir el mismo estado.
 * @transaction Ninguna: una lectura y una escritura con `actor.db`, como antes.
 * @sideEffects Ninguno (sin auditoría). La revalidación de la carta pública la hace la Server Action cuando sale bien.
 * @ficha permiso=carta_secciones transaccion=NINGUNA idempotencia=NO_APLICA auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function actualizarActivaSeccionCartaCasoDeUso(
  actor: Pick<ContextoUsuario, "db">,
  comando: ComandoActualizarActivaSeccionCarta,
): Promise<ResultadoActualizarActivaSeccionCarta> {
  const { seccionCartaId, activa } = comando;
  const existente = await actor.db.seccionCarta.findUnique({ where: { id: seccionCartaId } });
  if (!existente) return fracaso("SECCION_NO_ENCONTRADA", "No se encontró la sección de carta.");
  await fijarActivaDeSeccionCarta(actor.db, { id: seccionCartaId, activa });
  return exito(`Sección de carta "${existente.nombre}" ${activa ? "activada" : "desactivada"}.`, null);
}
