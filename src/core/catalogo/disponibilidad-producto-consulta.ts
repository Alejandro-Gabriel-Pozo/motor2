import type { Prisma, PrismaClient } from "@prisma/client";
import { resolverDisponibilidad, resolverDisponibilidadPorSucursal } from "./disponibilidad-producto";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Capa de consulta de `disponibilidad-producto.ts` (pura) — separada a propósito en su PROPIO archivo, aunque el plan
 * (docs/plan-disponibilidad-por-sucursal-2026-09-23.md §3) las diseñó juntas: `disponibilidad-producto.ts` importa `@/lib/db`
 * acá, y eso arrastra Prisma/`pg` al bundle del cliente en cuanto un componente "use client" importe un VALOR (no un tipo) del
 * mismo archivo — el bug real que ya reventó el build una vez esta sesión (rendimiento-recetas-vistas.ts, ver su docstring).
 * Nunca reunir Prisma con las funciones puras de disponibilidad en el mismo archivo.
 *
 * Ninguna pantalla escribe `{ disponibilidades: { some: ... } }` a mano — todas pasan por acá. Fijado por el guardián de
 * arquitectura `test/arquitectura/disponibilidad-en-un-solo-lugar.test.ts` (P12).
 */

/** El ÚNICO lugar donde se escribe el criterio como `where` de Prisma para "disponible en ESTA sucursal". */
export function whereDisponibleEn(sucursalId: string): Prisma.ProductoWhereInput {
  return { disponibilidades: { some: { sucursalId, disponible: true } } };
}

/** El equivalente del `activo: true` global de antes — para las validaciones del catálogo central (nombre único, unidad de un Insumo, etc.), que no son decisiones de una sucursal puntual. */
export function whereDisponibleEnAlguna(): Prisma.ProductoWhereInput {
  return { disponibilidades: { some: { disponible: true } } };
}

export async function productoDisponibleEn(sucursalId: string, productoId: string, db: Db): Promise<boolean> {
  const fila = await db.disponibilidadProducto.findUnique({ where: { sucursalId_productoId: { sucursalId, productoId } } });
  return resolverDisponibilidad(fila);
}

/** Batch — para listados/reportes, sin N+1. Todo id que no tenga fila para `sucursalId` cae en `false`. */
export async function disponibilidadDeProductos(sucursalId: string, productoIds: readonly string[], db: Db): Promise<Map<string, boolean>> {
  if (productoIds.length === 0) return new Map();
  const filas = await db.disponibilidadProducto.findMany({ where: { sucursalId, productoId: { in: [...productoIds] } } });
  const porProducto = new Map(filas.map((f) => [f.productoId, f.disponible]));
  return new Map(productoIds.map((id) => [id, porProducto.get(id) === true]));
}

export interface DisponibilidadEnSucursal {
  sucursalId: string;
  sucursalNombre: string;
  disponible: boolean;
}

/** Para la ficha de producto: el estado en TODAS las sucursales activas, incluidas las que no tienen fila propia (quedan en `false`). */
export async function disponibilidadPorSucursalDeProducto(productoId: string, db: Db): Promise<DisponibilidadEnSucursal[]> {
  const [sucursales, filas] = await Promise.all([
    db.sucursal.findMany({ where: { activo: true }, select: { id: true, nombre: true }, orderBy: { nombre: "asc" } }),
    db.disponibilidadProducto.findMany({ where: { productoId } }),
  ]);
  const porSucursal = resolverDisponibilidadPorSucursal(filas, sucursales.map((s) => s.id));
  return sucursales.map((s) => ({ sucursalId: s.id, sucursalNombre: s.nombre, disponible: porSucursal.get(s.id) === true }));
}
