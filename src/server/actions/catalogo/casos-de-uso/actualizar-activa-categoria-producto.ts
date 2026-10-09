import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { MENSAJE_CATEGORIA_NO_ENCONTRADA } from "@/core/features/catalogo/categorias-producto.guard";
import type { ComandoActualizarActivaCategoriaProducto, ResultadoActualizarActivaCategoriaProducto } from "@/core/features/catalogo/categorias-producto.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { fijarActivaDeCategoria } from "@/server/persistencia/catalogo/categorias-producto";

/**
 * Caso de uso «activar o desactivar una categoría de producto» (Hito 4 de la pureza, bloque 4.3, paso H4C-7 — `docs/plan-hito-4-pureza.md` §3). Es el cuerpo que
 * antes vivía en línea en la Server Action `actualizarActivaCategoriaProducto` (`src/server/actions/catalogo/categorias-producto.ts`): una sola escritura con la
 * base del contexto, sin leer antes la categoría, sin transacción ni auditoría. La Server Action quedó como adaptador (`conPermisoDeEmpresa("categorias")` → este
 * caso de uso → si salió bien, `refrescarVistaSiHaceFalta` → `aResultadoAccion`).
 *
 * O.44 (Hito 4, bloque D; CAMBIA COMPORTAMIENTO, aprobado por el dueño el 2026-10-08): un id que no existe (o de otra empresa) ya no hace lanzar a Prisma (un 500):
 * la escritura es un `updateMany` y su `count` en 0 devuelve `CATEGORIA_NO_ENCONTRADA` («No se encontró la categoría.») sin escribir nada; la acción no refresca.
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos.
 *
 * @contract Deja la categoría activa o inactiva, si existe.
 * @idempotency No aplica — repetir el pedido vuelve a escribir el mismo estado.
 * @transaction Ninguna: una sola escritura con `actor.db`, como antes.
 * @sideEffects Ninguno (sin auditoría: no es plata). El refresco de la vista lo hace la Server Action.
 * @ficha permiso=categorias transaccion=NINGUNA idempotencia=NO_APLICA auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function actualizarActivaCategoriaProductoCasoDeUso(
  actor: Pick<ContextoUsuario, "db">,
  comando: ComandoActualizarActivaCategoriaProducto,
): Promise<ResultadoActualizarActivaCategoriaProducto> {
  if (!(await fijarActivaDeCategoria(actor.db, { id: comando.categoriaId, activo: comando.activo }))) return fracaso("CATEGORIA_NO_ENCONTRADA", MENSAJE_CATEGORIA_NO_ENCONTRADA);
  return exito(`Categoría ${comando.activo ? "activada" : "desactivada"}.`, null);
}
