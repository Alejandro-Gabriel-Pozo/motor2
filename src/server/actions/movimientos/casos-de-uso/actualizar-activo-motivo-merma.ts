import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import type { ComandoActualizarActivoMotivo, ResultadoActualizarActivoMotivo } from "@/core/features/movimientos/motivos.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { fijarActivoDeMotivoMerma } from "@/server/persistencia/movimientos/motivos";

/**
 * Caso de uso «activar o desactivar un motivo de merma» (Hito 4 de la pureza, bloque C de la pieza carta/catálogo/stock, paso H4C-17 —
 * `docs/plan-hito-4-pureza.md` §3). Es el cuerpo que antes vivía en línea en la Server Action `actualizarActivoMotivoMerma`
 * (`src/server/actions/movimientos/motivos.ts`), movido TAL CUAL: lee el motivo («No se encontró el motivo.») y cambia `activo` con la base del contexto, sin
 * transacción ni auditoría. Nunca se borra (FK ON DELETE RESTRICT desde Operacion.motivoId): solo deja de ofrecerse en cargas nuevas. La Server Action quedó como
 * adaptador (`conPermisoDeEmpresa("motivos_merma")` → este caso de uso → si salió bien, refrescar la vista → `aResultadoAccion`).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos.
 *
 * @contract Deja el motivo activo o inactivo, salvo que no exista.
 * @idempotency No aplica — repetir el pedido vuelve a escribir el mismo estado.
 * @transaction Ninguna: una lectura y una escritura con `actor.db`, como antes.
 * @sideEffects Ninguno (sin auditoría: no es plata). El refresco de la vista lo hace la Server Action.
 * @ficha permiso=motivos_merma transaccion=NINGUNA idempotencia=NO_APLICA auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function actualizarActivoMotivoMermaCasoDeUso(
  actor: Pick<ContextoUsuario, "db">,
  comando: ComandoActualizarActivoMotivo,
): Promise<ResultadoActualizarActivoMotivo> {
  const motivo = await actor.db.motivoMerma.findUnique({ where: { id: comando.id } });
  if (!motivo) return fracaso("NO_ENCONTRADO", "No se encontró el motivo.");

  await fijarActivoDeMotivoMerma(actor.db, { id: comando.id, activo: comando.activo });
  return exito(`Motivo "${motivo.nombre}" ${comando.activo ? "activado" : "desactivado"}.`, null);
}
