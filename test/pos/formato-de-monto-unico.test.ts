import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatearMonto } from "../../src/core/pos/public";

/**
 * Contratos compartidos, dinero: el formato de un monto del POS (el aviso «se registró la venta por $ 1.234,5») sale de UNA sola fuente, `formatearMonto` (src/core/pos/formato.ts).
 * `server/actions/pos/cuenta-comun.ts` tenía un `MONEDA` duplicado: se sacó. Este test fija (1) la salida de la fuente única y (2) que el duplicado no vuelve.
 * Desde 2026-11-09 (regla del dueño «1.000,00») el dinero sale SIEMPRE con 2 decimales: la tabla cambió de «$ 1.000» a «$ 1.000,00» (solo formato; antes eran 0 a 2
 * decimales) y se sacó la comparación con el duplicado viejo, que fijaba justo el formato anterior.
 */
const NBSP = "\u00a0";

const CASOS: [number, string][] = [
  [0, `$${NBSP}0,00`],
  [1000, `$${NBSP}1.000,00`],
  [1234.5, `$${NBSP}1.234,50`],
  [36000, `$${NBSP}36.000,00`],
  [0.01, `$${NBSP}0,01`],
  [1234567.891, `$${NBSP}1.234.567,89`],
  [-1500.75, `-$${NBSP}1.500,75`],
];

describe("formato de monto del POS: una sola fuente", () => {
  it.each(CASOS)("formatearMonto(%s) = punto de miles, coma decimal, 2 decimales y $ delante", (importe, esperado) => {
    expect(formatearMonto(importe)).toBe(esperado);
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
