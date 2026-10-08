import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import type { ComandoActivarPromoCarta, ResultadoActivarPromoCarta } from "@/core/features/carta/promos.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { fijarActivaDePromo } from "@/server/persistencia/carta/promos";

/**
 * Caso de uso «apagado (o prendido) GENERAL de una promo en la empresa» (Hito 4 de la pureza, bloque 4.2, paso H4C-3 — `docs/plan-hito-4-pureza.md` §3). Es el
 * cuerpo que antes vivía en línea en la Server Action `actualizarActivaPromoCarta` (`src/server/actions/carta/promos.ts`), movido TAL CUAL: la promo y la
 * escritura con la base del contexto, SIN transacción y sin auditoría, como antes (el estado prendido/apagado no es un precio). La Server Action quedó como
 * adaptador (`conPermisoDeEmpresa("carta_promo_definir")` → este caso de uso → `revalidarCartasPublicas` si salió bien → `aResultadoAccion`).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos.
 *
 * @contract Deja la promo prendida o apagada en toda la empresa (apagada no se ofrece en ninguna sucursal, tenga lo que tenga cada una).
 * @idempotency No aplica — repetir el pedido vuelve a escribir el mismo estado.
 * @transaction Ninguna: una sola escritura con `actor.db`, como antes.
 * @sideEffects Ninguno (sin auditoría: no es un precio). La revalidación de la carta pública la hace la Server Action cuando sale bien.
 * @ficha permiso=carta_promo_definir transaccion=NINGUNA idempotencia=NO_APLICA auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function actualizarActivaPromoCartaCasoDeUso(actor: Pick<ContextoUsuario, "db">, comando: ComandoActivarPromoCarta): Promise<ResultadoActivarPromoCarta> {
  const { promoCartaId, activa } = comando;
  const existente = await actor.db.promoCarta.findUnique({ where: { id: promoCartaId } });
  if (!existente) return fracaso("PROMO_NO_ENCONTRADA", "No se encontró la promo.");
  await fijarActivaDePromo(actor.db, { id: promoCartaId, activa });
  return exito(`Promo "${existente.titulo}" ${activa ? "activada" : "desactivada"} en toda la empresa.`, null);
}
