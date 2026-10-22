import type { Prisma, PrismaClient } from "@prisma/client";
import { sucursalTieneCapacidad } from "@/server/acceso/capacidades-sucursal";
import { filtrarPreciosLocalesVigentes, type PrecioLocalVigente } from "@/core/catalogo/public";

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
 * La fila del precio local de UN producto en la sucursal —habilitada o no— y si la sucursal tiene prendido el precio propio, para EDITARLO (el paso 2 del espacio del producto, «Precio en la sucursal»):
 * es lo que vio quien guarda, el valor que `setPrecioLocalProducto` compara dentro de la transacción. NO decide ningún precio: lo que se cobra lo dice `preciosLocalesVigentes`. Quien la llama
 * decide si quien mira puede ver el precio local (`precio_local`): esta lectura no pone permisos.
 */
export async function precioLocalGuardadoDe(
  sucursalId: string,
  db: Db,
  productoId: string
): Promise<{ guardado: { precio: number; habilitado: boolean } | null; capacidadActiva: boolean }> {
  const [capacidadActiva, fila] = await Promise.all([
    precioLocalActivoEn(sucursalId, db),
    db.precioLocalProducto.findUnique({ where: { sucursalId_productoId: { sucursalId, productoId } }, select: { precio: true, habilitado: true } }),
  ]);
  return { guardado: fila ? { precio: Number(fila.precio), habilitado: fila.habilitado } : null, capacidadActiva };
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
