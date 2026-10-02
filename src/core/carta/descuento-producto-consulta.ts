import type { Prisma, PrismaClient } from "@prisma/client";
import { precioLocalActivoEn } from "@/core/catalogo/public-servidor";
import { descuentosVigentes } from "./descuento-producto";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * El ÚNICO lugar que lee `DescuentoProductoSucursal`. Los descuentos CONFIGURADOS de la sucursal (los que no tienen fila no están en el mapa = sin
 * descuento), tengan o no la capacidad `precio_local` prendida: es lo que muestra y edita el admin. Para decidir un PRECIO se usa
 * `descuentosDeProductoEnSucursal`. Sin `productoIds`, trae los de toda la sucursal. Fijado por el guardián
 * `test/arquitectura/descuento-producto-en-un-solo-lugar.test.ts`.
 */
export async function descuentosConfiguradosEnSucursal(sucursalId: string, db: Db, productoIds?: readonly string[]): Promise<Map<string, number>> {
  if (productoIds && productoIds.length === 0) return new Map();
  const filas = await db.descuentoProductoSucursal.findMany({
    where: { sucursalId, ...(productoIds ? { productoId: { in: [...productoIds] } } : {}) },
    select: { productoId: true, porcentaje: true },
  });
  return new Map(filas.map((f) => [f.productoId, Number(f.porcentaje)]));
}

/**
 * El % de descuento que RIGE para cada producto en la sucursal: los configurados, solo si la sucursal tiene prendida la capacidad `precio_local`
 * (R1, ver `descuentosVigentes`). Es el que usan la carta pública, el selector del POS y el alta a la cuenta.
 */
export async function descuentosDeProductoEnSucursal(sucursalId: string, db: Db, productoIds?: readonly string[]): Promise<Map<string, number>> {
  const [configurados, precioLocalActivo] = await Promise.all([descuentosConfiguradosEnSucursal(sucursalId, db, productoIds), precioLocalActivoEn(sucursalId, db)]);
  return descuentosVigentes(configurados, precioLocalActivo);
}

/** ¿Tiene descuento en ALGUNA sucursal? Un producto así no puede ser opción de un ítem agrupado (el renglón agrupado muestra un solo precio). */
export async function productoTieneDescuentoEnAlgunaSucursal(productoId: string, db: Db): Promise<boolean> {
  return (await db.descuentoProductoSucursal.count({ where: { productoId } })) > 0;
}
