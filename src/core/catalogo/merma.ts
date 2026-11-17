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

/**
 * En qué BASE están escritas las cantidades de una versión (M2 de `docs/diseno-merma-sobre-bruto-como-pedernal-2026-11-15.md`): NETA (lo que llega al plato; todo lo ya cargado) o BRUTA (lo que sale del
 * stock). La marca nace con la versión y no cambia; una versión no mezcla bases. Espejo del CHECK `RecetaVersion_baseDeCantidad_chk` / `VersionDeOpcion_baseDeCantidad_chk`.
 */
export const BASES_DE_CANTIDAD = ["NETA", "BRUTA"] as const;
export type BaseDeCantidad = (typeof BASES_DE_CANTIDAD)[number];

/**
 * La marca leída de la base, validada. CIERRA, NO ABRE (diseño §7.2): un valor que no es NETA ni BRUTA (columna ilegible, dato corrupto) lanza error explícito; nunca se asume una base ni se omite la merma.
 */
export function leerBaseDeCantidad(valor: unknown): BaseDeCantidad {
  if (valor === "NETA" || valor === "BRUTA") return valor;
  throw new Error(`La base de cantidad de la versión no es legible: ${JSON.stringify(valor)} (tiene que ser NETA o BRUTA).`);
}

/** El factor `1 + merma/100` en `number`: lo multiplican (o dividen, en la inversa del reporte de rendimiento) los llamadores que trabajan con `number`. */
export function factorDeMerma(mermaPorcentaje: number): number {
  return 1 + mermaPorcentaje / 100;
}

/** El mismo factor en decimal exacto, para los llamadores que multiplican con decimal.js (el consumo de la línea configurada). */
export function factorDeMermaExacto(mermaPorcentaje: Decimal.Value): Decimal {
  return new D(1).plus(new D(mermaPorcentaje).dividedBy(100));
}

/**
 * M3a (diseño de merma §7.2): por cuánto hay que multiplicar la cantidad ESCRITA en una línea para saber lo que sale del stock y se costea (el BRUTO), según la base de la versión a la que pertenece.
 * - NETA (todo lo ya cargado): la cantidad es lo que llega al plato, el bruto suma la merma: el factor de siempre, `factorDeMerma` (bit a bit lo mismo que antes de M3a).
 * - BRUTA: la cantidad YA es el bruto: factor 1 (sin multiplicar por la merma).
 * Una marca que no es NETA ni BRUTA CIERRA (lanza error): nunca se asume una base ni se omite la merma.
 */
export function factorDeBruto(base: BaseDeCantidad, mermaPorcentaje: number): number {
  return leerBaseDeCantidad(base) === "BRUTA" ? 1 : factorDeMerma(mermaPorcentaje);
}

/** Lo mismo que `factorDeBruto` en decimal exacto (consumo de la línea configurada). */
export function factorDeBrutoExacto(base: BaseDeCantidad, mermaPorcentaje: Decimal.Value): Decimal {
  return leerBaseDeCantidad(base) === "BRUTA" ? new D(1) : factorDeMermaExacto(mermaPorcentaje);
}
