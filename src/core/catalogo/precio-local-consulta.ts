import type { Prisma, PrismaClient } from "@prisma/client";
import { sucursalTieneCapacidad } from "@/core/permisos/capacidades-sucursal";
import { filtrarPreciosLocalesVigentes, type PrecioLocalVigente } from "./precio-local";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * ¿La sucursal tiene prendida la capacidad `precio_local`? Es el interruptor único de TODO precio propio de la sucursal (decisión del dueño,
 * 2026-10-01, R1): apagarla hace que rijan el precio central, el precio de la promo de la empresa y SIN el descuento de producto. Es el único
 * lugar que lee esa capacidad para decidir un precio; fijado por `test/arquitectura/precio-local-en-un-solo-lugar.test.ts`.
 */
export async function precioLocalActivoEn(sucursalId: string, db: Db): Promise<boolean> {
  return sucursalTieneCapacidad(sucursalId, "precio_local", db);
}

/**
 * El ÚNICO lugar que lee `PrecioLocalProducto` para decidir un precio: devuelve los Precios Locales VIGENTES de la sucursal
 * (capacidad `precio_local` + fila habilitada, ver `filtrarPreciosLocalesVigentes`), en 2 consultas para todo el lote. Todo
 * id que no esté en el mapa se cobra y se muestra al precio central. Sin `productoIds`, trae los de toda la sucursal.
 * Fijado por el guardián `test/arquitectura/precio-local-en-un-solo-lugar.test.ts`.
 *
 * `precioLocalActivo`: la capacidad ya leída (`precioLocalActivoEn(sucursalId, db)`, o la promesa de esa lectura, para no esperar a que termine) de ESTA
 * sucursal, para no volver a leerla — una pantalla que resuelve varios precios (el selector de carta del POS) la leía hasta seis veces (O.39 de
 * docs/pureza-integracion.md). Sin ella se lee acá, como siempre.
 */
export async function preciosLocalesVigentes(
  sucursalId: string,
  db: Db,
  productoIds?: readonly string[],
  precioLocalActivo?: boolean | Promise<boolean>
): Promise<Map<string, PrecioLocalVigente>> {
  if (productoIds && productoIds.length === 0) return new Map();
  const [capacidadActiva, filas] = await Promise.all([
    precioLocalActivo ?? precioLocalActivoEn(sucursalId, db),
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
