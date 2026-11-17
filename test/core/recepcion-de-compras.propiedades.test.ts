import { describe, it } from "vitest";
import fc from "fast-check";
import { prorratearPrecioDeRenglon } from "../../src/core/compras/public";

/**
 * Tests basados en propiedades (fast-check) del reparto del precio de un renglón entre sus entradas de stock (`prorratearPrecioDeRenglon`, src/core/compras/recepcion.ts; Compras N3-b). Función pura, sin Postgres.
 * Propiedades: la suma de las partes es EXACTAMENTE el precio del renglón (en centavos enteros), ninguna parte es negativa, hay una parte por entrada y el resultado es determinista.
 */
const RUNS = { numRuns: 2000 };

/** El precio total en centavos enteros (hasta 999.999.999.999,99) y las cantidades en pasos enteros de 10^-4 (mayores que cero), como las del renglón. */
const centavos = fc.integer({ min: 0, max: 99_999_999_999_999 });
const cantidades = fc.array(fc.integer({ min: 1, max: 99_999_999 }).map((pasos) => pasos / 10_000), { minLength: 1, maxLength: 8 });
const enCentavos = (pesos: number[]) => pesos.reduce((s, p) => s + Math.round(p * 100), 0);

describe("prorratearPrecioDeRenglon: propiedades", () => {
  it("la suma de las partes es exactamente el precio del renglón", () => {
    fc.assert(fc.property(centavos, cantidades, (c, qs) => enCentavos(prorratearPrecioDeRenglon(c / 100, qs)) === c), RUNS);
  });

  it("ninguna parte es negativa y hay exactamente una parte por entrada", () => {
    fc.assert(
      fc.property(centavos, cantidades, (c, qs) => {
        const partes = prorratearPrecioDeRenglon(c / 100, qs);
        return partes.length === qs.length && partes.every((p) => p >= 0 && Number.isFinite(p));
      }),
      RUNS
    );
  });

  it("es determinista: la misma entrada da siempre el mismo reparto", () => {
    fc.assert(fc.property(centavos, cantidades, (c, qs) => JSON.stringify(prorratearPrecioDeRenglon(c / 100, qs)) === JSON.stringify(prorratearPrecioDeRenglon(c / 100, [...qs]))), RUNS);
  });

  it("con una sola entrada, esa entrada se lleva el precio entero", () => {
    fc.assert(fc.property(centavos, fc.integer({ min: 1, max: 99_999_999 }), (c, pasos) => prorratearPrecioDeRenglon(c / 100, [pasos / 10_000]).join() === String(c / 100)), RUNS);
  });
});
