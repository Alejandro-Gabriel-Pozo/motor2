import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import type { ComandoActivarPromoCarta, ResultadoActivarPromoCarta } from "@/core/features/carta/promos.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { fijarActivaDePromoEnSucursal } from "@/server/persistencia/carta/promos";

/**
 * Caso de uso «prender o apagar una promo EN LA SUCURSAL ACTIVA» (Hito 4 de la pureza, bloque 4.2, paso H4C-3 — `docs/plan-hito-4-pureza.md` §3). Es el cuerpo
 * que antes vivía en línea en la Server Action `actualizarActivaPromoCartaEnSucursal` (`src/server/actions/carta/promos.ts`), movido TAL CUAL: la promo y la
 * escritura con la base del contexto, SIN transacción y sin auditoría, como antes. La Server Action quedó como adaptador (`conPermiso("carta_promo_activar")`
 * → este caso de uso → `revalidarCartasPublicas` si salió bien → `aResultadoAccion`).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos. Escribe SOLO la fila de la sucursal activa (`actor.sucursalId`); si la
 * sucursal todavía no la ofrecía, la fila nace con ese estado y sin precio local (`fijarActivaDePromoEnSucursal`). Las demás sucursales no se tocan.
 *
 * @contract Deja la promo prendida o apagada en la sucursal activa (apagada no va en la carta ni en el POS de esa sucursal).
 * @idempotency No aplica — repetir el pedido vuelve a escribir el mismo estado.
 * @transaction Ninguna: una sola escritura con `actor.db`, como antes.
 * @sideEffects Ninguno (sin auditoría: no es un precio). La revalidación de la carta pública la hace la Server Action cuando sale bien.
 * @ficha permiso=carta_promo_activar transaccion=NINGUNA idempotencia=NO_APLICA auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function actualizarActivaPromoCartaEnSucursalCasoDeUso(
  actor: Pick<ContextoUsuario, "db" | "sucursalId">,
  comando: ComandoActivarPromoCarta,
): Promise<ResultadoActivarPromoCarta> {
  const { promoCartaId, activa } = comando;
  const existente = await actor.db.promoCarta.findUnique({ where: { id: promoCartaId } });
  if (!existente) return fracaso("PROMO_NO_ENCONTRADA", "No se encontró la promo.");
  await fijarActivaDePromoEnSucursal(actor.db, { promoCartaId, sucursalId: actor.sucursalId, activa });
  return exito(`Promo "${existente.titulo}" ${activa ? "prendida" : "apagada"} en esta sucursal.`, null);
}
