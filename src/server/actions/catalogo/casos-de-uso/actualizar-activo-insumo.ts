import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { MENSAJE_INSUMO_NO_ENCONTRADO } from "@/core/features/catalogo/insumos.guard";
import type { ComandoActualizarActivoInsumo, ResultadoActualizarActivoInsumo } from "@/core/features/catalogo/insumos.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { fijarActivoDeInsumo } from "@/server/persistencia/catalogo/insumos";

/**
 * Caso de uso «activar o desactivar un insumo» (Hito 4 de la pureza, bloque 4.3, paso H4C-9 — `docs/plan-hito-4-pureza.md` §3). Es el cuerpo que antes vivía en
 * línea en la Server Action `actualizarActivoInsumo` (`src/server/actions/catalogo/insumos.ts`): una sola escritura con la base del contexto, sin leer antes el
 * insumo, sin transacción ni auditoría. La Server Action quedó como adaptador (`conPermisoDeEmpresa("grupos_familia")` → este caso de uso → si salió bien,
 * `refrescarVistaSiHaceFalta` → `aResultadoAccion`).
 *
 * O.44 (Hito 4, bloque D; CAMBIA COMPORTAMIENTO, aprobado por el dueño el 2026-10-08): un id que no existe (o de otra empresa) ya no hace lanzar a Prisma (un 500):
 * la escritura es un `updateMany` y su `count` en 0 devuelve `INSUMO_NO_ENCONTRADO` («No se encontró el insumo.») sin escribir nada; la acción no refresca.
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos.
 *
 * @contract Deja el insumo activo o inactivo, si existe.
 * @idempotency No aplica — repetir el pedido vuelve a escribir el mismo estado.
 * @transaction Ninguna: una sola escritura con `actor.db`, como antes.
 * @sideEffects Ninguno (sin auditoría). El refresco de la vista lo hace la Server Action.
 * @ficha permiso=grupos_familia transaccion=NINGUNA idempotencia=NO_APLICA auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function actualizarActivoInsumoCasoDeUso(actor: Pick<ContextoUsuario, "db">, comando: ComandoActualizarActivoInsumo): Promise<ResultadoActualizarActivoInsumo> {
  if (!(await fijarActivoDeInsumo(actor.db, { id: comando.insumoId, activo: comando.activo }))) return fracaso("INSUMO_NO_ENCONTRADO", MENSAJE_INSUMO_NO_ENCONTRADO);
  return exito(`Insumo ${comando.activo ? "activado" : "desactivado"}.`, null);
}
