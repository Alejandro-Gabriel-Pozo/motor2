import "server-only";
import type { Db } from "@/lib/db-tipos";
import { cargarOfertasDeProveedores } from "@/server/lecturas/catalogo/ofertas-de-proveedor";

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

/**
 * "Lo que se le compra" en la ficha del proveedor: lo que la EMPRESA le compró, DERIVADO del Kardex vigente (una compra anulada o de un proveedor corregido ya no cuenta; ver
 * `cargarOfertasDeProveedores`), con la unidad de compra y la referencia del proveedor, por nombre de producto. Una fila por producto.
 */
export async function listarProductosQueLeCompran(proveedorId: string, db: Db) {
  const ofertas = await cargarOfertasDeProveedores(db, { proveedorId });
  if (ofertas.length === 0) return [];
  const productos = new Map(
    (await db.producto.findMany({ where: { id: { in: ofertas.map((o) => o.productoId) } }, select: { id: true, codigo: true, nombre: true } })).map((p) => [p.id, p])
  );
  return ofertas
    .flatMap((o) => {
      const producto = productos.get(o.productoId);
      return producto ? [{ ...o, producto }] : [];
    })
    .sort((a, b) => a.producto.nombre.localeCompare(b.producto.nombre));
}

/** El proveedor solo, sin relaciones (formulario de edición, `/catalogo/proveedores/[id]/editar`). `null` si no existe. */
export async function obtenerProveedorPorId(id: string, db: Db) {
  return db.proveedor.findUnique({ where: { id } });
}
