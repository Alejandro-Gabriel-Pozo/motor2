import "server-only";
import type { Db } from "@/lib/db-tipos";

/**
 * Lecturas de Catálogo › Proveedores para los Server Components (Task #41, Fase D2). Mismo contrato que
 * `src/server/consultas/catalogo/productos.ts` (el piloto D1): `server-only`, sin guarda de permiso (la hace la página antes de
 * llamar), último parámetro `db: Db`, y devuelve EXACTAMENTE lo que devolvía la consulta Prisma que reemplaza.
 */

/** Ficha de un proveedor (`/catalogo/proveedores/[id]`): el proveedor con sus productos en consignación (sin orden explícito). `null` si no existe. */
export async function obtenerFichaProveedor(id: string, db: Db) {
  return db.proveedor.findUnique({
    where: { id },
    include: { productosConsignados: true },
  });
}

/** "Lo que se le compra" en la ficha del proveedor: sus filas de `ProveedorPorProducto` con producto y unidad de compra, por nombre de producto. */
export async function listarProductosQueLeCompran(proveedorId: string, db: Db) {
  return db.proveedorPorProducto.findMany({
    where: { proveedorId },
    include: { producto: true, unidadCompra: true },
    orderBy: { producto: { nombre: "asc" } },
  });
}

/** El proveedor solo, sin relaciones (formulario de edición, `/catalogo/proveedores/[id]/editar`). `null` si no existe. */
export async function obtenerProveedorPorId(id: string, db: Db) {
  return db.proveedor.findUnique({ where: { id } });
}
