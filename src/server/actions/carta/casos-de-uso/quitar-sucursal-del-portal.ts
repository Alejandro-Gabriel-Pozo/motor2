import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import type { ComandoQuitarSucursalDelPortal, ResultadoQuitarSucursalDelPortal } from "@/core/features/carta/registro-publico.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { quitarRegistroPublicoDeSucursal } from "@/server/persistencia/carta/registro-publico";

/**
 * Caso de uso «sacar la sucursal del registro del portal» (docs/plan-registro-tenants-2026-09-24.md, M6; Hito 5, bloque D, `docs/plan-hito-5-pureza.md` §6.1). Es el
 * cuerpo que antes vivía en línea en la Server Action `quitarSucursalDelPortal` (`src/server/actions/carta/registro-publico.ts`), movido TAL CUAL: una lectura y un borrado
 * con la base del contexto, sin transacción ni auditoría. Es la vuelta atrás del alta: borra la fila del registro y la sucursal desaparece del portal (la sucursal en sí no
 * se toca). La Server Action quedó como adaptador (`conPermisoDeEmpresa("carta_portal")` → `guardComandoQuitarSucursalDelPortal` → este caso de uso →
 * `revalidarCartasPublicas` si salió bien → `aResultadoAccion`).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos ni que el id sea un texto (el guard).
 *
 * @contract Deja a la sucursal fuera del registro del portal; el mensaje nombra la sucursal y el slug que tenía.
 * @idempotency No aplica — repetir el pedido responde «Esta sucursal no está en el portal.» (la fila ya no está), sin escribir.
 * @transaction Ninguna: una lectura y un borrado con `actor.db`, como antes.
 * @sideEffects Ninguno (sin auditoría). La revalidación de la carta pública la hace la Server Action cuando sale bien.
 * @ficha permiso=carta_portal transaccion=NINGUNA idempotencia=NO_APLICA auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function quitarSucursalDelPortalCasoDeUso(actor: Pick<ContextoUsuario, "db">, comando: ComandoQuitarSucursalDelPortal): Promise<ResultadoQuitarSucursalDelPortal> {
  const { sucursalId } = comando;
  const existente = await actor.db.sucursalPublica.findFirst({ where: { sucursalId }, select: { id: true, slug: true, sucursal: { select: { nombre: true } } } });
  if (!existente) return fracaso("NO_ESTA_EN_EL_PORTAL", "Esta sucursal no está en el portal.");
  await quitarRegistroPublicoDeSucursal(actor.db, { id: existente.id });
  return exito(`"${existente.sucursal.nombre}" quitada del portal (slug ${existente.slug}).`, null);
}
