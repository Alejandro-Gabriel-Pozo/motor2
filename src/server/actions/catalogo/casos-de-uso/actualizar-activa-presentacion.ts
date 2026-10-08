import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { MENSAJE_PRESENTACION_NO_ENCONTRADA } from "@/core/features/catalogo/productos.guard";
import type { ComandoActualizarActivaPresentacion, ResultadoActualizarActivaPresentacion } from "@/core/features/catalogo/productos.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { fijarActivaDePresentacion } from "@/server/persistencia/catalogo/productos";

/**
 * Caso de uso «activar o desactivar una presentación de compra» (Hito 4 de la pureza, bloque 4.3, paso H4C-11 — `docs/plan-hito-4-pureza.md` §3). Es el cuerpo que
 * antes vivía en línea en la Server Action `actualizarActivaPresentacion` (`src/server/actions/catalogo/productos.ts`): una sola escritura con la base del
 * contexto, sin transacción ni auditoría (activa no cambia el factor). La Server Action quedó como adaptador (`conPermisoDeEmpresa("producto_presentaciones")` →
 * este caso de uso → `aResultadoAccion`; nunca refrescó la vista).
 *
 * O.44 (Hito 4, bloque D; CAMBIA COMPORTAMIENTO, aprobado por el dueño el 2026-10-08): cierra el hallazgo que H4C-11 migró tal cual — un id roto (inexistente o
 * de otra empresa) hacía lanzar a Prisma y el usuario veía un 500. Ahora la escritura es un `updateMany` y su `count` en 0 devuelve `PRESENTACION_NO_ENCONTRADA`
 * («No se encontró la presentación.») sin escribir nada.
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos.
 *
 * @contract Deja la presentación activa o inactiva, si existe.
 * @idempotency No aplica — repetir el pedido vuelve a escribir el mismo estado.
 * @transaction Ninguna: una sola escritura con `actor.db`, como antes.
 * @sideEffects Ninguno (sin auditoría).
 * @ficha permiso=producto_presentaciones transaccion=NINGUNA idempotencia=NO_APLICA auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function actualizarActivaPresentacionCasoDeUso(
  actor: Pick<ContextoUsuario, "db">,
  comando: ComandoActualizarActivaPresentacion,
): Promise<ResultadoActualizarActivaPresentacion> {
  if (!(await fijarActivaDePresentacion(actor.db, { id: comando.presentacionId, activa: comando.activa }))) return fracaso("PRESENTACION_NO_ENCONTRADA", MENSAJE_PRESENTACION_NO_ENCONTRADA);
  return exito(`Presentación ${comando.activa ? "activada" : "desactivada"}.`, null);
}
