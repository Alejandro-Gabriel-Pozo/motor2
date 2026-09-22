/**
 * Mediana de una lista de números — usada para "cantidad típica" en el
 * historial de compras de una MP (docs/planes-demo-y-claridad-reportes-
 * 2026-09-21.md §4, decisión 1): resiste el stock inicial (una compra
 * grande al arrancar no distorsiona el número, a diferencia del promedio).
 *
 * `null` con lista vacía — no hay "cantidad típica" sin datos. Con cantidad
 * par de elementos, promedia los dos centrales (definición estándar).
 */
export function mediana(valores: number[]): number | null {
  if (valores.length === 0) return null;
  const ordenados = [...valores].sort((a, b) => a - b);
  const mitad = Math.floor(ordenados.length / 2);
  return ordenados.length % 2 !== 0 ? ordenados[mitad]! : (ordenados[mitad - 1]! + ordenados[mitad]!) / 2;
}
