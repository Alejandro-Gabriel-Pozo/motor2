import { Decimal } from "decimal.js";

/**
 * La FÓRMULA ÚNICA del factor de merma (M0 de `docs/diseno-merma-sobre-bruto-como-pedernal-2026-11-15.md`): `1 + merma/100`, que hasta ahora estaba escrita nueve veces en cinco archivos
 * (venta, producción, costos, reporte de rendimiento y consumo de la línea configurada). Es un REFACTOR PURO: devuelve exactamente los mismos números que la expresión de antes, bit a bit.
 *
 * Por eso la función expone solo el FACTOR, no la cuenta entera: cada llamador sigue multiplicando en el MISMO orden que antes (`cantidad * ef.cantidad * factor`, nunca reasociado: el orden de las
 * multiplicaciones cambia los últimos bits de un `number`; ver `core/movimientos/linea-de-venta.ts`). Una prueba (`test/catalogo/merma.test.ts`) fija la igualdad con la expresión vieja en una grilla,
 * y `test/arquitectura/formula-de-merma-unica.test.ts` impide que la expresión vuelva a aparecer escrita a mano fuera de este archivo.
 *
 * Función pura: sin base, sin reloj, sin azar.
 */

/** Misma configuración de decimal.js que `core/movimientos/consumo-de-linea-configurada.ts` (donde se usaba esta cuenta): 40 dígitos, mitad hacia arriba. */
const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

/** El factor `1 + merma/100` en `number`: lo multiplican (o dividen, en la inversa del reporte de rendimiento) los llamadores que trabajan con `number`. */
export function factorDeMerma(mermaPorcentaje: number): number {
  return 1 + mermaPorcentaje / 100;
}

/** El mismo factor en decimal exacto, para los llamadores que multiplican con decimal.js (el consumo de la línea configurada). */
export function factorDeMermaExacto(mermaPorcentaje: Decimal.Value): Decimal {
  return new D(1).plus(new D(mermaPorcentaje).dividedBy(100));
}
