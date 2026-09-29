import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Port de resolverStockMinimo_ (Catalogo.js:1968-1979): gana la fila de la
 * sección exacta si existe; si no, la fila "global" de la sucursal
 * (seccionId null); si no hay ninguna, null — "sin mínimo cargado" y
 * "mínimo cargado en 0" son cosas distintas (0 es un mínimo real: "avisame
 * si esto se termina del todo").
 */
export async function resolverStockMinimo(sucursalId: string, productoId: string, seccionId: string | null, db: Db): Promise<number | null> {
  if (seccionId) {
    const porSeccion = await db.stockMinimoProducto.findUnique({ where: { productoId_seccionId: { productoId, seccionId } } });
    if (porSeccion) return Number(porSeccion.minimo);
  }
  const global = await db.stockMinimoProducto.findFirst({ where: { sucursalId, productoId, seccionId: null } });
  return global ? Number(global.minimo) : null;
}
