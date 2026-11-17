import Decimal from "decimal.js";

/**
 * Suma EXACTA (decimal.js) de cantidades de stock para las pruebas: `0,1 + 0,2` da `0,3`, no `0,30000000000000004`. Así las
 * expectativas comparan con `toBe` exacto en vez de `toBeCloseTo` (A1b 2026-11-16: el stock tiene 4 decimales fijos y el exacto 8).
 */
export function sumaExacta(valores: readonly number[]): number {
  return valores.reduce((suma, v) => suma.plus(v), new Decimal(0)).toNumber();
}
