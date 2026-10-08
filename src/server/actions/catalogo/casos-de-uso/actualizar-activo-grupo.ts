import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import type { ComandoActualizarActivoGrupo, ResultadoSinFracasosDeInsumos } from "@/core/features/catalogo/insumos.schema";
import { exito } from "@/core/resultado-caso";
import { fijarActivoDeGrupo } from "@/server/persistencia/catalogo/grupos";

/**
 * Caso de uso «activar o desactivar un grupo de insumos» (Hito 4 de la pureza, bloque 4.3, paso H4C-9 — `docs/plan-hito-4-pureza.md` §3). Es el cuerpo que antes
 * vivía en línea en la Server Action `actualizarActivoGrupo` (`src/server/actions/catalogo/insumos.ts`), movido TAL CUAL: una sola escritura con la base del
 * contexto, sin leer antes el grupo (un id que no existe hace lanzar a Prisma, como antes), sin transacción ni auditoría. La Server Action quedó como adaptador
 * (`conPermisoDeEmpresa("grupos_familia")` → este caso de uso → `refrescarVistaSiHaceFalta` → `aResultadoAccion`).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos.
 *
 * @contract Deja el grupo activo o inactivo.
 * @idempotency No aplica — repetir el pedido vuelve a escribir el mismo estado.
 * @transaction Ninguna: una sola escritura con `actor.db`, como antes.
 * @sideEffects Ninguno (sin auditoría). El refresco de la vista lo hace la Server Action.
 * @ficha permiso=grupos_familia transaccion=NINGUNA idempotencia=NO_APLICA auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function actualizarActivoGrupoCasoDeUso(actor: Pick<ContextoUsuario, "db">, comando: ComandoActualizarActivoGrupo): Promise<ResultadoSinFracasosDeInsumos> {
  await fijarActivoDeGrupo(actor.db, { id: comando.grupoId, activo: comando.activo });
  return exito(`Grupo ${comando.activo ? "activado" : "desactivado"}.`, null);
}
