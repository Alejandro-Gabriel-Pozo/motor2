import "server-only";
import type { Prisma } from "@prisma/client";

async function buscarProductoConUnidades(tx: Prisma.TransactionClient, id: string) {
  return tx.producto.findUnique({ where: { id }, include: { unidadStock: true, unidadCompra: true } });
}

type ProductoConUnidades = Awaited<ReturnType<typeof buscarProductoConUnidades>>;

/**
 * Memoiza producto.findUnique DENTRO de una misma transacción — el mismo
 * producto (Muzzarella, Harina, la prepizza...) se vuelve a pedir varias
 * veces por línea/venta (al armarla, al calcular sus consumos de receta, al
 * escribir la fila), y con SERIALIZABLE la transacción ya ve una foto
 * consistente de principio a fin, así que cachear acá no cambia ningún
 * resultado — solo evita round-trips redundantes a una DB remota, que es lo
 * que hacía vencer el timeout de 60s en ventas/compras con muchos items.
 */
export function crearCacheProducto(tx: Prisma.TransactionClient) {
  const cache = new Map<string, ProductoConUnidades>();
  return async (id: string): Promise<ProductoConUnidades> => {
    if (cache.has(id)) return cache.get(id)!;
    const producto = await buscarProductoConUnidades(tx, id);
    cache.set(id, producto);
    return producto;
  };
}
