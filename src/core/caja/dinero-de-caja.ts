import { IMPORTE_MAXIMO, esImporteDeColumna } from "@/core/datos/importe";

/**
 * Dinero de la caja (docs/diseno-caja-y-cobro-paridad-pedernal-escalera-2026-11-16.md, I-3): TODA la cuenta se hace en CENTAVOS ENTEROS (`bigint`), nunca con `number` decimal. La moneda es una sola, pesos
 * argentinos (`MONEDA_FIJA`, poda del 2026-11-06). El ancho es el de la columna `Decimal(14,2)` que el dueño confirmó el 2026-11-16 («El de Motor2 hoy»); el tope vive en UNA constante, `IMPORTE_MAXIMO`
 * (`src/core/datos/importe.ts`), así que cambiarlo cambia todo a la vez.
 *
 * Puro: sin reloj, sin azar, sin I/O.
 */

/** Pasa un importe en pesos (a lo sumo 2 decimales, menor que `IMPORTE_MAXIMO` en valor absoluto) a centavos enteros; `null` si no entra en una columna `Decimal(14,2)`. */
export function centavosDeImporte(importe: number): bigint | null {
  if (!esImporteDeColumna(importe)) return null;
  // Con a lo sumo 2 decimales y menos de 1e12, `importe * 100` queda a menos de 1e-3 de un entero: `Math.round` es exacto.
  return BigInt(Math.round(importe * 100));
}

/** El importe de una columna `Decimal(14,2)` (en pesos, 2 decimales) a partir de centavos enteros. Solo para escribir y mostrar: nunca para sumar. */
export function importeDeCentavos(centavos: bigint): number {
  return Number(centavos) / 100;
}

/** El tope en centavos (exclusivo): el importe más grande que entra en la columna es `TOPE_EN_CENTAVOS - 1`. */
export const TOPE_EN_CENTAVOS: bigint = BigInt(IMPORTE_MAXIMO) * BigInt(100);
