import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import type { ComandoActualizarActivoMotivo, ResultadoActualizarActivoMotivo } from "@/core/features/movimientos/motivos.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { fijarActivoDeDestinoConsumo } from "@/server/persistencia/movimientos/motivos";

/**
 * Caso de uso «activar o desactivar un destino de consumo» (Hito 4 de la pureza, bloque C de la pieza carta/catálogo/stock, paso H4C-17 —
 * `docs/plan-hito-4-pureza.md` §3). Es el cuerpo que antes vivía en línea en la Server Action `actualizarActivoDestinoConsumo`
 * (`src/server/actions/movimientos/motivos.ts`), movido TAL CUAL: igual que el de un motivo de merma (`actualizar-activo-motivo-merma.ts`), con sus textos
 * («No se encontró el destino.»). La Server Action quedó como adaptador (`conPermisoDeEmpresa("motivos_destino_consumo")` → este caso de uso → si salió bien,
 * refrescar la vista → `aResultadoAccion`).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos.
 *
 * @contract Deja el destino activo o inactivo, salvo que no exista.
 * @idempotency No aplica — repetir el pedido vuelve a escribir el mismo estado.
 * @transaction Ninguna: una lectura y una escritura con `actor.db`, como antes.
 * @sideEffects Ninguno (sin auditoría: no es plata). El refresco de la vista lo hace la Server Action.
 * @ficha permiso=motivos_destino_consumo transaccion=NINGUNA idempotencia=NO_APLICA auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function actualizarActivoDestinoConsumoCasoDeUso(
  actor: Pick<ContextoUsuario, "db">,
  comando: ComandoActualizarActivoMotivo,
): Promise<ResultadoActualizarActivoMotivo> {
  const destino = await actor.db.destinoConsumo.findUnique({ where: { id: comando.id } });
  if (!destino) return fracaso("NO_ENCONTRADO", "No se encontró el destino.");

  await fijarActivoDeDestinoConsumo(actor.db, { id: comando.id, activo: comando.activo });
  return exito(`Destino "${destino.nombre}" ${comando.activo ? "activado" : "desactivado"}.`, null);
}
