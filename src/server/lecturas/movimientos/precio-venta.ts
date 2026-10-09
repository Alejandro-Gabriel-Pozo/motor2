import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import { preciosLocalesVigentes } from "@/server/lecturas/catalogo/precio-local";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Port de resolverPrecioVenta_ (Catalogo.js:2072-2077): Precio Local VIGENTE
 * (capacidad `precio_local` de la sucursal + fila habilitada, ver
 * `preciosLocalesVigentes`); si no, el global (Producto.precioVenta).
 */
export async function resolverPrecioVenta(sucursalId: string, productoId: string, precioGlobal: number, db: Db): Promise<number> {
  const vigentes = await preciosLocalesVigentes(sucursalId, db, [productoId]);
  return vigentes.get(productoId)?.precio ?? precioGlobal;
}
