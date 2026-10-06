import { redondearMoneda } from "@/core/moneda";

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
/** El gasto en Compras de un producto en la ventana elegida, tal como lo lee la consulta (`server/consultas/stock/sugerencia-clase-a.ts`). */
export interface CompraDeProducto {
  productoId: string;
  importe: number;
}

/** El corte Pareto 80/20 sobre las compras ya leídas. Puro: no consulta la base. */
export function seleccionarClaseA(compras: readonly CompraDeProducto[], nombrePorId: ReadonlyMap<string, string>): InsumoClaseA[] {
  if (compras.length === 0) return [];

  const totalGastado = compras.reduce((acc, c) => acc + c.importe, 0);
  let acumulado = 0;
  const lista = compras
    .map((c) => ({ productoId: c.productoId, nombre: nombrePorId.get(c.productoId) ?? "(producto eliminado)", importe: c.importe }))
    .sort((a, b) => b.importe - a.importe)
    .map((f) => {
      acumulado += f.importe;
      return { ...f, importe: redondearMoneda(f.importe), porcentajeAcumulado: totalGastado > 0 ? Math.round((acumulado / totalGastado) * 1000) / 10 : 0 };
    });

  // Corte Pareto 80/20 — mismo criterio que periodo.ts:500-501: de mayor a menor gasto, hasta el primero donde el acumulado llega al 80 % (ese incluido).
  const corte80 = lista.findIndex((f) => f.porcentajeAcumulado >= 80);
  return corte80 >= 0 ? lista.slice(0, corte80 + 1) : lista;
}
