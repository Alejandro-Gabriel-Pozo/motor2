import "server-only";
import { ocultoPor } from "@/core/catalogo/ocultar-producto";
import type { Db } from "@/lib/db-tipos";

/**
 * Los lectores de «Ocultar» (docs/diseno-ocultar-como-pedernal-2026-11-15.md, I-12): ¿está el producto oculto en esta sucursal? = hay una marca `oculto` de la empresa o de la sucursal (`ocultoPor`, una sola
 * definición). Sin marca = visible. Los usan la venta (dentro de su transacción) y las pantallas. El `where` de Prisma para los listados es `whereNoOcultoEn` (core). FALLA CERRADO (I-13): si la lectura falla,
 * el error sube y no se agrega la línea; nunca se asume «visible».
 */
export async function productoOcultoEn(sucursalId: string, productoId: string, db: Db): Promise<boolean> {
  return (await productosOcultosEn(sucursalId, [productoId], db)).has(productoId);
}

/** Batch — de estos productos, cuáles están ocultos en la sucursal (UNA consulta). Sin productos no lee nada. */
export async function productosOcultosEn(sucursalId: string, productoIds: readonly string[], db: Db): Promise<Set<string>> {
  if (productoIds.length === 0) return new Set();
  const filas = await db.ocultamientoProducto.findMany({
    where: { productoId: { in: [...productoIds] }, oculto: true, OR: [{ sucursalId: null }, { sucursalId }] },
    select: { productoId: true, sucursalId: true, oculto: true },
  });
  const ocultos = new Set<string>();
  for (const id of new Set(filas.map((f) => f.productoId))) {
    if (ocultoPor(filas.filter((f) => f.productoId === id), sucursalId) !== null) ocultos.add(id);
  }
  return ocultos;
}
