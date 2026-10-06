import "server-only";
import { seleccionarClaseA, type InsumoClaseA } from "@/core/stock/public";
import type { Db } from "@/lib/db-tipos";

/**
 * Sugiere a qué ~10-15 insumos conviene ponerles agenda de conteo semanal (los que concentran el 80 % del gasto en Compras de la ventana, regla 80/20 clase A;
 * sub-plan S4, docs/plan-rendimiento-recetas-2026-09-22.md §E). La lectura vive acá; el corte Pareto es puro y vive en `core/stock/sugerencia-clase-a.ts`
 * (Pureza Fase 3). Corte por PRODUCTO, no por Insumo agrupado: hace falta un `productoId` concreto para pre-marcar el formulario de S5.
 */
export async function sugerirInsumosClaseA(sucursalId: string, desde: Date, hasta: Date, db: Db): Promise<InsumoClaseA[]> {
  const compras = await db.movimientoStock.groupBy({
    by: ["productoId"],
    where: { seccion: { sucursalId }, proceso: "COMPRA", operacion: { fecha: { gte: desde, lte: hasta }, anuladaEn: null } },
    _sum: { precioTotal: true },
  });
  if (compras.length === 0) return [];

  const productos = await db.producto.findMany({ where: { id: { in: compras.map((c) => c.productoId) } }, select: { id: true, nombre: true } });
  const nombrePorId = new Map(productos.map((p) => [p.id, p.nombre]));

  return seleccionarClaseA(
    compras.map((c) => ({ productoId: c.productoId, importe: Number(c._sum.precioTotal ?? 0) })),
    nombrePorId,
  );
}
