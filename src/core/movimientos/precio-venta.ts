import type { Prisma, PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Port de resolverPrecioVenta_ (Catalogo.js:2072-2077): Precio Local si
 * está cargado Y habilitado para esta sucursal; si no, el global
 * (Producto.precioVenta) como fallback.
 */
export async function resolverPrecioVenta(sucursalId: string, productoId: string, precioGlobal: number, db: Db): Promise<number> {
  const local = await db.precioLocalProducto.findUnique({
    where: { sucursalId_productoId: { sucursalId, productoId } },
  });
  if (local?.habilitado) return Number(local.precio);
  return precioGlobal;
}
