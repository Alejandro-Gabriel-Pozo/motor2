import type { Prisma, PrismaClient } from "@prisma/client";
import { sucursalTieneCapacidad } from "@/core/permisos/capacidades-sucursal";
import { filtrarPreciosLocalesVigentes, type PrecioLocalVigente } from "./precio-local";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * El ÚNICO lugar que lee `PrecioLocalProducto` para decidir un precio: devuelve los Precios Locales VIGENTES de la sucursal
 * (capacidad `precio_local` + fila habilitada, ver `filtrarPreciosLocalesVigentes`), en 2 consultas para todo el lote. Todo
 * id que no esté en el mapa se cobra y se muestra al precio central. Sin `productoIds`, trae los de toda la sucursal.
 * Fijado por el guardián `test/arquitectura/precio-local-en-un-solo-lugar.test.ts`.
 */
export async function preciosLocalesVigentes(sucursalId: string, db: Db, productoIds?: readonly string[]): Promise<Map<string, PrecioLocalVigente>> {
  if (productoIds && productoIds.length === 0) return new Map();
  const [capacidadActiva, filas] = await Promise.all([
    sucursalTieneCapacidad(sucursalId, "precio_local", db),
    db.precioLocalProducto.findMany({
      where: { sucursalId, habilitado: true, ...(productoIds ? { productoId: { in: [...productoIds] } } : {}) },
      select: { productoId: true, precio: true, habilitado: true },
    }),
  ]);
  return filtrarPreciosLocalesVigentes(
    filas.map((f) => ({ productoId: f.productoId, precio: Number(f.precio), habilitado: f.habilitado })),
    capacidadActiva
  );
}
