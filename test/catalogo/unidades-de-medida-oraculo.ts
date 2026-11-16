/**
 * ORÁCULO de las unidades de medida (docs/diseno-unidades-de-medida-como-pedernal-2026-11-15.md, etapa U0): lo esperado ESCRITO APARTE
 * del código. No importa nada de `src/core/catalogo/unidades-de-medida.ts`: si lo hiciera, el test compararía el código consigo mismo.
 * Las 14 unidades se copian a mano de `migraciones/0025_catalogo.sql` de Pedernal (código, dimensión, símbolo, cuántas unidades base
 * entran en esta), y la expectativa de cada conversión se calcula con `decimal.js` (otra aritmética que la `bigint` del código).
 */
import { Decimal } from "decimal.js";

export interface UnidadEsperada {
  readonly codigo: string;
  readonly dimension: string;
  readonly simbolo: string;
  /** Unidades base de la dimensión que entran en 1 de esta. */
  readonly factor: number;
  readonly motivo: string;
}

export const UNIDADES_ESPERADAS: readonly UnidadEsperada[] = [
  { codigo: "UNIDAD", dimension: "CONTEO", simbolo: "u", factor: 1, motivo: "base de conteo" },
  { codigo: "GRAMO", dimension: "MASA", simbolo: "g", factor: 1, motivo: "base de masa" },
  { codigo: "KILOGRAMO", dimension: "MASA", simbolo: "kg", factor: 1_000, motivo: "1 kg = 1.000 g" },
  { codigo: "TONELADA", dimension: "MASA", simbolo: "t", factor: 1_000_000, motivo: "1 t = 1.000 kg" },
  { codigo: "MILILITRO", dimension: "VOLUMEN", simbolo: "ml", factor: 1, motivo: "base de volumen" },
  { codigo: "LITRO", dimension: "VOLUMEN", simbolo: "l", factor: 1_000, motivo: "1 l = 1.000 ml" },
  { codigo: "METRO_CUBICO", dimension: "VOLUMEN", simbolo: "m3", factor: 1_000_000, motivo: "1 m3 = 1.000 l" },
  { codigo: "MILIMETRO", dimension: "LONGITUD", simbolo: "mm", factor: 1, motivo: "base de longitud" },
  { codigo: "CENTIMETRO", dimension: "LONGITUD", simbolo: "cm", factor: 10, motivo: "1 cm = 10 mm" },
  { codigo: "METRO", dimension: "LONGITUD", simbolo: "m", factor: 1_000, motivo: "1 m = 1.000 mm" },
  { codigo: "CENTIMETRO_CUADRADO", dimension: "SUPERFICIE", simbolo: "cm2", factor: 1, motivo: "base de superficie" },
  { codigo: "METRO_CUADRADO", dimension: "SUPERFICIE", simbolo: "m2", factor: 10_000, motivo: "1 m2 = 10.000 cm2" },
  { codigo: "MINUTO", dimension: "TIEMPO", simbolo: "min", factor: 1, motivo: "base de tiempo" },
  { codigo: "HORA", dimension: "TIEMPO", simbolo: "h", factor: 60, motivo: "1 h = 60 min" },
];

export const DIMENSIONES_ESPERADAS = ["CONTEO", "MASA", "VOLUMEN", "LONGITUD", "SUPERFICIE", "TIEMPO"] as const;

/** Tope de una columna `Decimal(14,4)`: menor que 10^10. */
const TOPE_EXCLUSIVO = new Decimal("10000000000");

/** Cantidades de prueba: cero, la mínima, redondas, con decimales, cerca del tope y justo en él. */
export const CANTIDADES_DE_PRUEBA = ["0", "0.0001", "0.001", "0.5", "1", "1.5", "12.3456", "60", "1000", "123456.789", "9999999999.9999"] as const;

export type Esperado = { ok: true; cantidad: string } | { ok: false; motivo: "DIMENSION_DISTINTA" | "CONVERSION_NO_EXACTA" | "FUERA_DE_RANGO" };

/** Lo que debe dar convertir `cantidad` de `de` a `a` (ambas del catálogo), con aritmética decimal exacta y el orden dimensión, exactitud, rango. */
export function esperadoDeConvertir(cantidad: string, de: UnidadEsperada, a: UnidadEsperada): Esperado {
  if (de.dimension !== a.dimension) return { ok: false, motivo: "DIMENSION_DISTINTA" };
  const resultado = new Decimal(cantidad).mul(de.factor).div(a.factor);
  if (resultado.decimalPlaces() > 4) return { ok: false, motivo: "CONVERSION_NO_EXACTA" };
  if (resultado.gte(TOPE_EXCLUSIVO)) return { ok: false, motivo: "FUERA_DE_RANGO" };
  return { ok: true, cantidad: resultado.toFixed(4) };
}

/** Conversiones con valor CONOCIDO escritas a mano (no calculadas): kg↔g, l↔ml y más. [cantidad, de, a, esperado] */
export const CONOCIDAS: ReadonlyArray<readonly [string, string, string, string]> = [
  ["1", "KILOGRAMO", "GRAMO", "1000.0000"],
  ["1", "GRAMO", "KILOGRAMO", "0.0010"],
  ["0.0001", "KILOGRAMO", "GRAMO", "0.1000"],
  ["2.5", "KILOGRAMO", "GRAMO", "2500.0000"],
  ["1500", "GRAMO", "KILOGRAMO", "1.5000"],
  ["1", "LITRO", "MILILITRO", "1000.0000"],
  ["250", "MILILITRO", "LITRO", "0.2500"],
  ["1", "TONELADA", "KILOGRAMO", "1000.0000"],
  ["1", "TONELADA", "GRAMO", "1000000.0000"],
  ["1", "METRO_CUBICO", "LITRO", "1000.0000"],
  ["1", "METRO", "CENTIMETRO", "100.0000"],
  ["1", "CENTIMETRO", "MILIMETRO", "10.0000"],
  ["1", "METRO_CUADRADO", "CENTIMETRO_CUADRADO", "10000.0000"],
  ["1", "HORA", "MINUTO", "60.0000"],
  ["90", "MINUTO", "HORA", "1.5000"],
  ["60", "MINUTO", "HORA", "1.0000"],
  ["7", "UNIDAD", "UNIDAD", "7.0000"],
];

/** Rechazos CONOCIDOS escritos a mano. [cantidad, de, a, motivo] */
export const RECHAZOS_CONOCIDOS: ReadonlyArray<readonly [string, string, string, string]> = [
  ["1", "GRAMO", "TONELADA", "CONVERSION_NO_EXACTA"],
  ["1", "MINUTO", "HORA", "CONVERSION_NO_EXACTA"],
  ["1", "KILOGRAMO", "LITRO", "DIMENSION_DISTINTA"],
  ["1", "UNIDAD", "GRAMO", "DIMENSION_DISTINTA"],
  ["1", "METRO", "METRO_CUADRADO", "DIMENSION_DISTINTA"],
  ["9999999999.9999", "KILOGRAMO", "GRAMO", "FUERA_DE_RANGO"],
  ["1", "CAJA", "UNIDAD", "UNIDAD_DESCONOCIDA"],
  ["1", "UNIDAD", "caja", "UNIDAD_DESCONOCIDA"],
  ["1", "kilogramo", "GRAMO", "UNIDAD_DESCONOCIDA"],
  ["1", "toString", "GRAMO", "UNIDAD_DESCONOCIDA"],
  ["1", "__proto__", "GRAMO", "UNIDAD_DESCONOCIDA"],
  ["1", "", "GRAMO", "UNIDAD_DESCONOCIDA"],
  ["", "GRAMO", "KILOGRAMO", "CANTIDAD_INVALIDA"],
  ["-1", "GRAMO", "KILOGRAMO", "CANTIDAD_INVALIDA"],
  ["+1", "GRAMO", "KILOGRAMO", "CANTIDAD_INVALIDA"],
  ["1,5", "GRAMO", "KILOGRAMO", "CANTIDAD_INVALIDA"],
  ["1.5.0", "GRAMO", "KILOGRAMO", "CANTIDAD_INVALIDA"],
  ["1e3", "GRAMO", "KILOGRAMO", "CANTIDAD_INVALIDA"],
  [" 1", "GRAMO", "KILOGRAMO", "CANTIDAD_INVALIDA"],
  ["01", "GRAMO", "KILOGRAMO", "CANTIDAD_INVALIDA"],
  [".5", "GRAMO", "KILOGRAMO", "CANTIDAD_INVALIDA"],
  ["1.", "GRAMO", "KILOGRAMO", "CANTIDAD_INVALIDA"],
  ["1.00001", "GRAMO", "KILOGRAMO", "CANTIDAD_INVALIDA"],
  ["NaN", "GRAMO", "KILOGRAMO", "CANTIDAD_INVALIDA"],
  ["Infinity", "GRAMO", "KILOGRAMO", "CANTIDAD_INVALIDA"],
  ["10000000000", "GRAMO", "GRAMO", "CANTIDAD_INVALIDA"],
  ["1".repeat(41), "GRAMO", "GRAMO", "CANTIDAD_INVALIDA"],
];
