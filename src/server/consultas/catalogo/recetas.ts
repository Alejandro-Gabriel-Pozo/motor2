import "server-only";
import { prisma, type Db } from "@/lib/db";
import { whereDisponibleEnAlguna } from "@/core/catalogo/disponibilidad-producto-consulta";

/**
 * Lecturas de Catálogo › Recetas para los Server Components (Task #41, Fase D3). Mismo contrato que
 * `server/consultas/catalogo/productos.ts` (ver su cabecera): `server-only`, sin guarda de permiso adentro (la página la hace
 * antes), `db: Db = prisma` al final y devuelve EXACTAMENTE lo que devolvía la consulta Prisma que reemplaza.
 *
 * El producto suelto del historial (`/catalogo/recetas/[productoId]/historial`) NO vive acá: reusa `obtenerProductoPorId`
 * de `productos.ts`.
 */

/**
 * Lista de recetas YA armadas (`/catalogo/recetas`): los productos disponibles en alguna sucursal que tienen al menos una
 * versión de receta, por nombre, cada uno con SOLO su última versión (`recetaVersiones[0]`, la de `version` más alta) y el
 * conteo de ingredientes de esa versión (`_count.ingredientes`). Lectura CENTRAL (lista de lectores-de-receta.test.ts): no
 * lee cantidad ni merma, así que no resuelve nada por sucursal.
 */
export async function listarProductosConReceta(db: Db = prisma) {
  return db.producto.findMany({
    where: { ...whereDisponibleEnAlguna(), recetaVersiones: { some: {} } },
    orderBy: { nombre: "asc" },
    include: {
      recetaVersiones: {
        orderBy: { version: "desc" },
        take: 1,
        include: { _count: { select: { ingredientes: true } } },
      },
    },
  });
}
