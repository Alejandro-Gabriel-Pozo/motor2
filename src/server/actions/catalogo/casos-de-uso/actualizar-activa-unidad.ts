import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { MENSAJE_UNIDAD_NO_ENCONTRADA } from "@/core/features/catalogo/unidades.guard";
import type { ComandoActualizarActivaUnidad, ResultadoActualizarActivaUnidad } from "@/core/features/catalogo/unidades.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { fijarActivaDeUnidad } from "@/server/persistencia/catalogo/unidades";

/**
 * Caso de uso «activar o desactivar una unidad de medida» (Hito 4 de la pureza, bloque 4.3, paso H4C-8 — `docs/plan-hito-4-pureza.md` §3). Es el cuerpo que antes
 * vivía en línea en la Server Action `actualizarActivaUnidad` (`src/server/actions/catalogo/unidades.ts`): una sola escritura con la base del contexto, sin leer
 * antes la unidad, sin transacción ni auditoría. La Server Action quedó como adaptador (`conPermisoDeEmpresa("unidades")` → este caso de uso → si salió bien,
 * `refrescarVistaSiHaceFalta` → `aResultadoAccion`).
 *
 * O.44 (Hito 4, bloque D; CAMBIA COMPORTAMIENTO, aprobado por el dueño el 2026-10-08): un id que no existe (o de otra empresa) ya no hace lanzar a Prisma (un 500):
 * la escritura es un `updateMany` y su `count` en 0 devuelve `UNIDAD_NO_ENCONTRADA` («No se encontró la unidad.») sin escribir nada; la acción no refresca.
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos.
 *
 * @contract Deja la unidad activa o inactiva, si existe.
 * @idempotency No aplica — repetir el pedido vuelve a escribir el mismo estado.
 * @transaction Ninguna: una sola escritura con `actor.db`, como antes.
 * @sideEffects Ninguno (activa no cambia el significado de ninguna cantidad: sin auditoría). El refresco de la vista lo hace la Server Action.
 * @ficha permiso=unidades transaccion=NINGUNA idempotencia=NO_APLICA auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function actualizarActivaUnidadCasoDeUso(actor: Pick<ContextoUsuario, "db">, comando: ComandoActualizarActivaUnidad): Promise<ResultadoActualizarActivaUnidad> {
  if (!(await fijarActivaDeUnidad(actor.db, { id: comando.unidadId, activa: comando.activa }))) return fracaso("UNIDAD_NO_ENCONTRADA", MENSAJE_UNIDAD_NO_ENCONTRADA);
  return exito(`Unidad ${comando.activa ? "activada" : "desactivada"}.`, null);
}
