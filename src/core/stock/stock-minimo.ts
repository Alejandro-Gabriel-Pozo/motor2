import type { Prisma, PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Port de resolverStockMinimo_ (Catalogo.js:1968-1979): gana la fila de la
 * sección exacta si existe; si no, la fila "global" de la sucursal
 * (seccionId null); si no hay ninguna, null — "sin mínimo cargado" y
 * "mínimo cargado en 0" son cosas distintas (0 es un mínimo real: "avisame
 * si esto se termina del todo").
 */
export async function resolverStockMinimo(sucursalId: string, productoId: string, seccionId: string | null, db: Db): Promise<number | null> {
  const porSeccion = seccionId ? await db.stockMinimoProducto.findUnique({ where: { productoId_seccionId: { productoId, seccionId } } }) : null;
  const global = porSeccion ? null : await db.stockMinimoProducto.findFirst({ where: { sucursalId, productoId, seccionId: null } });
  return elegirMinimo(porSeccion ? Number(porSeccion.minimo) : null, global ? Number(global.minimo) : null);
}

/**
 * La regla de prioridad del mínimo, en UN solo lugar (la usan `resolverStockMinimo` y `calcularAlertasStock`): gana el de la sección si
 * existe, si no el global de la sucursal, si no `null` ("sin mínimo cargado"). Un 0 es un mínimo real y gana sobre el global: por eso es `??`
 * y no `||`.
 */
export function elegirMinimo(porSeccion: number | null | undefined, global: number | null | undefined): number | null {
  return porSeccion ?? global ?? null;
}
