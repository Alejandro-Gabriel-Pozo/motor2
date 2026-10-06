import "server-only";
import type { Db } from "@/lib/db-tipos";

/**
 * Lecturas de Catálogo › Categorías para los Server Components (Task #41; Pureza 0.3). Mismo contrato que
 * `src/server/consultas/catalogo/productos.ts`: `server-only`, sin guarda de permiso (la hace la página antes de llamar), último
 * parámetro `db: Db`, y devuelve EXACTAMENTE lo que devolvía la consulta Prisma que reemplaza.
 */

/** Las categorías de producto activas, por nombre (pantalla «Margen objetivo»: una fila por categoría). */
export async function listarCategoriasActivas(db: Db) {
  return db.categoriaProducto.findMany({ where: { activo: true }, orderBy: { nombre: "asc" } });
}
