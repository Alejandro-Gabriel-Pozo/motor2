import { Decimal } from "decimal.js";

/**
 * CANTIDAD EXACTA (frente 3, etapa E-1b; docs/diseno-datos-paridad-pedernal-2026-11-16.md §4 y N1-6/N4-4). Dueño, 2026-11-16 («Fase 1 de los frentes» y «tercera tanda»,
 * `motor2-docs`, seguimiento-de-pedernal): «Pasar a cuenta exacta como Pedernal» y «4 decimales fijos como Pedernal».
 *
 * Qué resuelve: `redondearACantidadDeUnidad` (`core/movimientos/transiciones.ts`) redondea con `Math.round(cantidad * 10 ** decimales) / 10 ** decimales`, en coma flotante. Ahí
 * `1.005 * 100` da `100.49999999999999` y sube mal; y con negativos el empate va hacia +∞ (−0,125 → −0,12 con 2 decimales). Esta primitiva hace el redondeo en decimal EXACTO, igual que
 * `redondearMoneda` (`core/moneda.ts`) hace con el dinero.
 *
 * Regla de empate: ALEJÁNDOSE DEL CERO (`MITAD_SUBE_SIMETRICA` de Pedernal, `src/primitivas/cantidad/redondeo-entero.ts`: 10,005 → 10,01 y −10,005 → −10,01), igual que `NUMERIC` de Postgres.
 * DIFERENCIA DECLARADA con `Math.round`: solo cambia el resultado en un empate exacto NEGATIVO (−0,125 a 2 decimales: antes −0,12, ahora −0,13). Con cantidades positivas el resultado es
 * el mismo que daba `Math.round` salvo cuando el flotante caía apenas por debajo del empate (el error que se corrige). Quien aplique el cambio (frente 2, en su carril) mide antes el
 * efecto en el Kardex con la copia de solo lectura y regenera los goldens con ese motivo.
 *
 * Los decimales son un PARÁMETRO que por defecto vale `DECIMALES_DE_CANTIDAD` (4, la escala de las columnas `Decimal(14,4)` y la de Pedernal): se acepta de 0 a `MAXIMO_DE_DECIMALES` (8: el arrastre de cálculo de stock del frente 2 usa 8, ver su `redondearACantidadDeUnidad`) y cualquier otro valor
 * FALLA CERRADO (`RangeError`), igual que un valor que no es un número finito: no se devuelve `NaN` ni un valor a medias.
 *
 * Entra y sale `number` (el borde del dominio); el `Decimal` no sale de acá. `new Decimal(n)` toma la representación decimal más corta del double (`String(n)`), que es el valor que se
 * tecleó o vino de la base, no su expansión binaria. Normaliza `-0` a `0`. Puro: sin reloj, sin azar, sin I/O.
 */

/** Los decimales de una cantidad: 4 fijos, como Pedernal y como las columnas `Decimal(14,4)` de Motor2. */
export const DECIMALES_DE_CANTIDAD = 4;

/** El máximo de decimales que se acepta como parámetro: los de un cálculo intermedio (arrastre), no los que se guardan. */
export const MAXIMO_DE_DECIMALES = 8;

/** Clon propio: no depende de la configuración global de Decimal. Empates alejándose del cero. */
const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

/** Redondea `cantidad` a `decimales` en decimal exacto, con el empate alejándose del cero; normaliza `-0` a `0`. Ver el encabezado. */
export function redondearCantidadExacta(cantidad: number, decimales: number = DECIMALES_DE_CANTIDAD): number {
  if (!Number.isFinite(cantidad)) throw new RangeError("redondearCantidadExacta: la cantidad tiene que ser un número finito");
  if (!Number.isInteger(decimales) || decimales < 0 || decimales > MAXIMO_DE_DECIMALES) {
    throw new RangeError(`redondearCantidadExacta: los decimales tienen que ser un entero de 0 a ${MAXIMO_DE_DECIMALES}`);
  }
  const redondeado = new D(cantidad).toDecimalPlaces(decimales, D.ROUND_HALF_UP).toNumber();
  return redondeado === 0 ? 0 : redondeado;
}
