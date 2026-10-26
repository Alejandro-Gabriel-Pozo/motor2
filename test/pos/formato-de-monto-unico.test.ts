import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatearMonto } from "../../src/core/pos/public";

/**
 * Contratos compartidos, dinero: el formato de un monto del POS (el aviso «se registró la venta por $ 1.234,5») sale de UNA sola fuente, `formatearMonto` (src/core/pos/formato.ts).
 * `server/actions/pos/cuenta-comun.ts` tenía un `MONEDA` con las MISMAS opciones de `Intl.NumberFormat` (es-AR, ARS, 0 a 2 decimales): se sacó. Este test fija (1) que la salida de la
 * fuente única es la que daba el duplicado, importe por importe, y (2) que el duplicado no vuelve.
 */
const NBSP = "\u00a0";
/** Las opciones exactas del `MONEDA` que había en cuenta-comun.ts. */
const COMO_ERA_EN_CUENTA_COMUN = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 0, maximumFractionDigits: 2 });

const CASOS: [number, string][] = [
  [0, `$${NBSP}0`],
  [1000, `$${NBSP}1.000`],
  [1234.5, `$${NBSP}1.234,5`],
  [36000, `$${NBSP}36.000`],
  [0.01, `$${NBSP}0,01`],
  [1234567.891, `$${NBSP}1.234.567,89`],
  [-1500.75, `-$${NBSP}1.500,75`],
];

describe("formato de monto del POS: una sola fuente", () => {
  it.each(CASOS)("formatearMonto(%s) = el formato argentino de siempre (punto de miles, coma decimal, $ delante) y coincide con el duplicado que había", (importe, esperado) => {
    expect(formatearMonto(importe)).toBe(esperado);
    expect(formatearMonto(importe)).toBe(COMO_ERA_EN_CUENTA_COMUN.format(importe));
  });

  it("cuenta-comun.ts ya no define su propio formateador de moneda y el cierre de cuenta usa formatearMonto", () => {
    const comun = readFileSync("src/server/actions/pos/cuenta-comun.ts", "utf8");
    expect(comun).not.toMatch(/\bMONEDA\b/);
    expect(comun).not.toMatch(/style:\s*["']currency["']/);
    const cierre = readFileSync("src/server/actions/pos/casos-de-uso/cerrar-cuenta.ts", "utf8");
    expect(cierre).toMatch(/formatearMonto\(total\)/);
    expect(cierre).not.toMatch(/\bMONEDA\b/);
  });
});
