import type { Prisma, PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * El ÚNICO lugar que lee `DescuentoProductoSucursal` para decidir un precio: el % de descuento de cada producto EN la sucursal (los que no tienen fila
 * no están en el mapa = sin descuento). Sin `productoIds`, trae los de toda la sucursal. Fijado por el guardián
 * `test/arquitectura/descuento-producto-en-un-solo-lugar.test.ts`.
 */
export async function descuentosDeProductoEnSucursal(sucursalId: string, db: Db, productoIds?: readonly string[]): Promise<Map<string, number>> {
  if (productoIds && productoIds.length === 0) return new Map();
  const filas = await db.descuentoProductoSucursal.findMany({
    where: { sucursalId, ...(productoIds ? { productoId: { in: [...productoIds] } } : {}) },
    select: { productoId: true, porcentaje: true },
  });
  return new Map(filas.map((f) => [f.productoId, Number(f.porcentaje)]));
}

/** ¿Tiene descuento en ALGUNA sucursal? Un producto así no puede ser opción de un ítem agrupado (el renglón agrupado muestra un solo precio). */
export async function productoTieneDescuentoEnAlgunaSucursal(productoId: string, db: Db): Promise<boolean> {
  return (await db.descuentoProductoSucursal.count({ where: { productoId } })) > 0;
}
