import type { Prisma, PrismaClient } from "@prisma/client";
import { resolverDisponibilidad } from "@/core/catalogo/public";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Los lectores de disponibilidad de producto por sucursal (Pureza Fase 4, tramo A): mudados TAL CUAL desde `core/catalogo/disponibilidad-producto-consulta.ts` (mismo nombre y
 * firma). Los usan la venta (dentro de su transacción), los reportes y las pantallas. Sin `import "server-only"`: los importan scripts con `tsx` y Playwright. Ninguna pantalla
 * escribe `{ disponibilidades: { some: ... } }` a mano: el criterio (`whereDisponibleEn`) vive en core y lo fija `test/arquitectura/disponibilidad-en-un-solo-lugar.test.ts` (P12).
 */

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

/**
 * Batch — "¿está disponible en ALGUNA sucursal?" (el equivalente en memoria de `whereDisponibleEnAlguna`), para quien arma un mapa de
 * productos sin una sucursal puntual (reportes de Catálogo Central). Una sola consulta `distinct` sobre las filas disponibles — sin
 * `in: [ids]`, que con un catálogo grande toparía el límite de parámetros de Prisma. Todo id sin ninguna fila disponible cae en `false`.
 */
export async function disponibilidadEnAlgunaSucursal(productoIds: readonly string[], db: Db): Promise<Map<string, boolean>> {
  if (productoIds.length === 0) return new Map();
  const filas = await db.disponibilidadProducto.findMany({ where: { disponible: true }, select: { productoId: true }, distinct: ["productoId"] });
  const conAlguna = new Set(filas.map((f) => f.productoId));
  return new Map(productoIds.map((id) => [id, conAlguna.has(id)]));
}
