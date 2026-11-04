import "server-only";
import type { Db } from "@/lib/db-tipos";

/**
 * Qué productos ya tienen un vínculo con el proveedor (alguna fila de `ProveedorPorProducto` para el par, con cualquier unidad de compra y aunque su referencia esté vacía).
 * Una sola lectura para todas las líneas de una compra. Lo usa el registro de una Compra (compra simple y factura repartida) para exigir «cómo lo llama el proveedor» solo en la
 * PRIMERA compra del producto a ese proveedor (etapa 1 de Compras, CU7/I12). La RLS acota a la empresa. Devuelve solo ids: ningún dato sensible.
 */
export async function productosConVinculoConElProveedor(db: Db, proveedorId: string, productoIds: readonly string[]): Promise<Set<string>> {
  if (productoIds.length === 0) return new Set();
  const filas = await db.proveedorPorProducto.findMany({
    where: { proveedorId, productoId: { in: [...productoIds] } },
    select: { productoId: true },
  });
  return new Set(filas.map((f) => f.productoId));
}
