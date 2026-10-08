import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import type { ComandoActualizarActivaUnidad, ResultadoActualizarActivaUnidad } from "@/core/features/catalogo/unidades.schema";
import { exito } from "@/core/resultado-caso";
import { fijarActivaDeUnidad } from "@/server/persistencia/catalogo/unidades";

/**
 * Caso de uso «activar o desactivar una unidad de medida» (Hito 4 de la pureza, bloque 4.3, paso H4C-8 — `docs/plan-hito-4-pureza.md` §3). Es el cuerpo que antes
 * vivía en línea en la Server Action `actualizarActivaUnidad` (`src/server/actions/catalogo/unidades.ts`), movido TAL CUAL: una sola escritura con la base del
 * contexto, sin leer antes la unidad (un id que no existe hace lanzar a Prisma, como antes), sin transacción ni auditoría. La Server Action quedó como adaptador
 * (`conPermisoDeEmpresa("unidades")` → este caso de uso → `refrescarVistaSiHaceFalta` → `aResultadoAccion`).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos.
 *
 * @contract Deja la unidad activa o inactiva.
 * @idempotency No aplica — repetir el pedido vuelve a escribir el mismo estado.
 * @transaction Ninguna: una sola escritura con `actor.db`, como antes.
 * @sideEffects Ninguno (activa no cambia el significado de ninguna cantidad: sin auditoría). El refresco de la vista lo hace la Server Action.
 * @ficha permiso=unidades transaccion=NINGUNA idempotencia=NO_APLICA auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function actualizarActivaUnidadCasoDeUso(actor: Pick<ContextoUsuario, "db">, comando: ComandoActualizarActivaUnidad): Promise<ResultadoActualizarActivaUnidad> {
  await fijarActivaDeUnidad(actor.db, { id: comando.unidadId, activa: comando.activa });
  return exito(`Unidad ${comando.activa ? "activada" : "desactivada"}.`, null);
}
