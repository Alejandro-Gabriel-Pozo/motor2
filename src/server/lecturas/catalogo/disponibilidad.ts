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

/**
 * Batch — para listados/reportes, sin N+1. Todo id que no tenga fila para `sucursalId` cae en `false`. Es la de N sucursales
 * (`disponibilidadDeProductosEnSucursales`) con un solo elemento: UNA implementación (O.38b de docs/pureza-integracion.md, D3).
 */
export async function disponibilidadDeProductos(sucursalId: string, productoIds: readonly string[], db: Db): Promise<Map<string, boolean>> {
  return (await disponibilidadDeProductosEnSucursales([sucursalId], productoIds, db)).get(sucursalId)!;
}

/**
 * Batch de VARIAS sucursales en UNA consulta (O.38b, D3 de docs/plan-hito-4-pureza.md §4): `sucursalId` → (`productoId` → disponible), con el mismo criterio
 * que la de una sucursal (fila ausente = no disponible: todo id sin fila en esa sucursal cae en `false`). Cada sucursal sale en el resultado. Sin productos
 * no lee nada. Con un solo elemento lee lo mismo que antes (`IN ($1)` es `= $1` para Postgres). La usa el Consolidado con todas sus sucursales.
 */
export async function disponibilidadDeProductosEnSucursales(
  sucursalIds: readonly string[],
  productoIds: readonly string[],
  db: Db
): Promise<Map<string, Map<string, boolean>>> {
  if (productoIds.length === 0) return new Map(sucursalIds.map((id) => [id, new Map<string, boolean>()]));
  const filas = await db.disponibilidadProducto.findMany({ where: { sucursalId: { in: [...sucursalIds] }, productoId: { in: [...productoIds] } } });
  const filasPorSucursal = new Map(sucursalIds.map((s) => [s, new Map<string, boolean>()]));
  for (const f of filas) filasPorSucursal.get(f.sucursalId)?.set(f.productoId, f.disponible);
  return new Map(
    sucursalIds.map((s) => {
      const porProducto = filasPorSucursal.get(s)!;
      return [s, new Map(productoIds.map((id) => [id, porProducto.get(id) === true]))];
    })
  );
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
