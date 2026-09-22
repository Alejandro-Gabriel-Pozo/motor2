import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { redondearMoneda } from "@/core/movimientos/transiciones";

type Db = PrismaClient | Prisma.TransactionClient;

export interface InsumoClaseA {
  productoId: string;
  nombre: string;
  importe: number;
  /** % acumulado de gasto en Compras hasta esta fila (lista ordenada de mayor a menor) — mismo corte 80/20 que `calcularGastoPorInsumoDelPeriodo` (periodo.ts:500-501). */
  porcentajeAcumulado: number;
}

/**
 * Sugiere a qué ~10-15 insumos conviene ponerles agenda de conteo semanal,
 * sin que el dueño tenga que listarlos a mano (sub-plan S4, docs/plan-
 * rendimiento-recetas-2026-09-22.md §E — grounding §3.3): los que
 * concentran el 80 % del gasto en Compras de la ventana elegida (regla
 * 80/20, clase A). Corte por PRODUCTO, no por Insumo agrupado (a
 * diferencia de `calcularGastoPorInsumoDelPeriodo`): acá hace falta un
 * `productoId` concreto para poder pre-marcar el formulario de S5, algo
 * que agrupar por nombre de Insumo no da (varias MP hermanas comparten
 * nombre de Insumo pero cada una tiene su propia fila de
 * `FrecuenciaConteoProducto`).
 */
export async function sugerirInsumosClaseA(sucursalId: string, desde: Date, hasta: Date, db: Db = prisma): Promise<InsumoClaseA[]> {
  const compras = await db.movimientoStock.groupBy({
    by: ["productoId"],
    where: { seccion: { sucursalId }, proceso: "COMPRA", operacion: { fecha: { gte: desde, lte: hasta }, anuladaEn: null } },
    _sum: { precioTotal: true },
  });
  if (compras.length === 0) return [];

  const productos = await db.producto.findMany({ where: { id: { in: compras.map((c) => c.productoId) } }, select: { id: true, nombre: true } });
  const nombrePorId = new Map(productos.map((p) => [p.id, p.nombre]));

  const totalGastado = compras.reduce((acc, c) => acc + Number(c._sum.precioTotal ?? 0), 0);
  let acumulado = 0;
  const lista = compras
    .map((c) => ({ productoId: c.productoId, nombre: nombrePorId.get(c.productoId) ?? "(producto eliminado)", importe: Number(c._sum.precioTotal ?? 0) }))
    .sort((a, b) => b.importe - a.importe)
    .map((f) => {
      acumulado += f.importe;
      return { ...f, importe: redondearMoneda(f.importe), porcentajeAcumulado: totalGastado > 0 ? Math.round((acumulado / totalGastado) * 1000) / 10 : 0 };
    });

  // Corte Pareto 80/20 — mismo criterio que periodo.ts:500-501: de mayor a menor gasto, hasta el primero donde el acumulado llega al 80 % (ese incluido).
  const corte80 = lista.findIndex((f) => f.porcentajeAcumulado >= 80);
  return corte80 >= 0 ? lista.slice(0, corte80 + 1) : lista;
}
