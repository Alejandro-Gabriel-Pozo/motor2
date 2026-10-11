import "server-only";
import type { ContextoUsuario } from "@/server/sesion/contexto";
import type { ComandoQuitarSucursalDelPortal, ResultadoQuitarSucursalDelPortal } from "@/core/features/carta/registro-publico.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { apagarRegistroPublicoDeSucursal } from "@/server/persistencia/carta/registro-publico";

/**
 * Caso de uso «sacar la sucursal del registro del portal» (docs/plan-registro-tenants-2026-09-24.md, M6; Hito 5, bloque D, `docs/plan-hito-5-pureza.md` §6.1). Es el
 * cuerpo que antes vivía en línea en la Server Action `quitarSucursalDelPortal` (`src/server/actions/carta/registro-publico.ts`): una lectura y una escritura
 * con la base del contexto, sin transacción ni auditoría. Desde P16 (decisión del dueño, 2026-10-11) «quitar» APAGA, no borra: deja la fila con `publicada = false`, la sucursal desaparece
 * del portal y de su URL pública (el mismo 404 neutro que un slug inexistente, sin aviso propio, para que nadie pueda enumerar slugs), el slug queda RESERVADO y, si se vuelve a publicar,
 * el QR ya impreso vuelve a funcionar (la sucursal en sí no se toca). La Server Action quedó como adaptador (`conPermisoDeEmpresa("carta_portal")` → `guardComandoQuitarSucursalDelPortal` → este caso de uso →
 * `revalidarCartasPublicas` si salió bien → `aResultadoAccion`).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos ni que el id sea un texto (el guard).
 *
 * @contract Deja a la sucursal fuera del portal (`publicada = false`) y conserva su fila y su slug; el mensaje nombra la sucursal y el slug reservado. Sin fila → «no está en el portal».
 * @idempotency Por estado — repetir el pedido sobre una fila ya apagada vuelve a dar ok y deja el mismo estado; solo responde «Esta sucursal no está en el portal.» si nunca se agregó.
 * @transaction Ninguna: una lectura y una escritura con `actor.db`, como antes.
 * @sideEffects Ninguno (sin auditoría). La revalidación de la carta pública la hace la Server Action cuando sale bien.
 * @ficha permiso=carta_portal transaccion=NINGUNA idempotencia=POR_ESTADO auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function quitarSucursalDelPortalCasoDeUso(actor: Pick<ContextoUsuario, "db">, comando: ComandoQuitarSucursalDelPortal): Promise<ResultadoQuitarSucursalDelPortal> {
  const { sucursalId } = comando;
  const existente = await actor.db.sucursalPublica.findFirst({ where: { sucursalId }, select: { id: true, slug: true, sucursal: { select: { nombre: true } } } });
  if (!existente) return fracaso("NO_ESTA_EN_EL_PORTAL", "Esta sucursal no está en el portal.");
  await apagarRegistroPublicoDeSucursal(actor.db, { id: existente.id });
  return exito(`"${existente.sucursal.nombre}" quitada del portal (slug ${existente.slug} reservado: vuelve a verse al publicarla).`, null);
}
