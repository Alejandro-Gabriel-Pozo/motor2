import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import type { ComandoActualizarActivaCategoriaProducto, ResultadoActualizarActivaCategoriaProducto } from "@/core/features/catalogo/categorias-producto.schema";
import { exito } from "@/core/resultado-caso";
import { fijarActivaDeCategoria } from "@/server/persistencia/catalogo/categorias-producto";

/**
 * Caso de uso «activar o desactivar una categoría de producto» (Hito 4 de la pureza, bloque 4.3, paso H4C-7 — `docs/plan-hito-4-pureza.md` §3). Es el cuerpo que
 * antes vivía en línea en la Server Action `actualizarActivaCategoriaProducto` (`src/server/actions/catalogo/categorias-producto.ts`), movido TAL CUAL: una sola
 * escritura con la base del contexto, sin leer antes la categoría (un id que no existe hace lanzar a Prisma, como antes), sin transacción ni auditoría. La Server
 * Action quedó como adaptador (`conPermisoDeEmpresa("categorias")` → este caso de uso → `refrescarVistaSiHaceFalta` → `aResultadoAccion`).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos.
 *
 * @contract Deja la categoría activa o inactiva.
 * @idempotency No aplica — repetir el pedido vuelve a escribir el mismo estado.
 * @transaction Ninguna: una sola escritura con `actor.db`, como antes.
 * @sideEffects Ninguno (sin auditoría: no es plata). El refresco de la vista lo hace la Server Action.
 * @ficha permiso=categorias transaccion=NINGUNA idempotencia=NO_APLICA auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function actualizarActivaCategoriaProductoCasoDeUso(
  actor: Pick<ContextoUsuario, "db">,
  comando: ComandoActualizarActivaCategoriaProducto,
): Promise<ResultadoActualizarActivaCategoriaProducto> {
  await fijarActivaDeCategoria(actor.db, { id: comando.categoriaId, activo: comando.activo });
  return exito(`Categoría ${comando.activo ? "activada" : "desactivada"}.`, null);
}
