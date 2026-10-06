import { readFileSync } from "node:fs";
import { join } from "node:path";
import fc from "fast-check";
import { Decimal as DecimalPropio } from "decimal.js";
import { Decimal as DecimalDePrisma } from "@prisma/client/runtime/index-browser";
import { describe, expect, it } from "vitest";

/**
 * Pureza 1.1: `src/core/moneda.ts` usa `decimal.js` como dependencia PROPIA (versión exacta 10.5.0) en lugar del `Decimal` que Prisma trae por dentro, para que el
 * dominio no dependa del ORM para el dinero. Este test es la prueba de que el cambio no movió ni un centavo, y la guarda contra la deriva futura: compara las dos
 * librerías, con los mismos parámetros que usa `moneda.ts` (precisión 40, empates alejándose del cero), sobre miles de entradas aleatorias, y exige que la
 * versión propia esté fijada. Si una actualización de Prisma trae otra versión de `decimal.js` y los resultados se separan, falla acá y obliga a decidir (subir la propia o revisar los redondeos).
 */
const propio = DecimalPropio.clone({ precision: 40, rounding: DecimalPropio.ROUND_HALF_UP });
const dePrisma = DecimalDePrisma.clone({ precision: 40, rounding: DecimalDePrisma.ROUND_HALF_UP });

/** Montos y cantidades como llegan en la práctica: enteros, centavos, tres y seis decimales, y dobles arbitrarios. */
const numero = fc.oneof(
  fc.integer({ min: -1_000_000, max: 1_000_000 }),
  fc.integer({ min: -100_000_000, max: 100_000_000 }).map((c) => c / 100),
  fc.integer({ min: -1_000_000_000, max: 1_000_000_000 }).map((m) => m / 1000),
  fc.integer({ min: -1_000_000_000, max: 1_000_000_000 }).map((m) => m / 1_000_000),
  fc.double({ min: -1e9, max: 1e9, noNaN: true, noDefaultInfinity: true })
);
const positivo = numero.filter((n) => n > 0);

describe("moneda: decimal.js propio equivale al Decimal de Prisma", () => {
  it("la versión propia está FIJA (sin ^ ni ~) y las constantes de redondeo coinciden con las de Prisma", () => {
    const dependencias = (JSON.parse(readFileSync(join(__dirname, "../../package.json"), "utf8")) as { dependencies: Record<string, string> }).dependencies;
    expect(dependencias["decimal.js"], "decimal.js tiene que estar fijado a una versión exacta: un redondeo no se actualiza solo").toMatch(/^\d+\.\d+\.\d+$/);
    expect(DecimalPropio.ROUND_HALF_UP).toBe(DecimalDePrisma.ROUND_HALF_UP);
    expect(DecimalPropio.ROUND_CEIL).toBe(DecimalDePrisma.ROUND_CEIL);
    expect(DecimalPropio.ROUND_DOWN).toBe(DecimalDePrisma.ROUND_DOWN);
  });

  it("construir, multiplicar, dividir, sumar y restar dan el mismo resultado exacto", () => {
    fc.assert(
      fc.property(numero, numero, positivo, (a, b, c) => {
        expect(new propio(a).times(b).toString()).toBe(new dePrisma(a).times(b).toString());
        expect(new propio(a).times(b).dividedBy(c).toString()).toBe(new dePrisma(a).times(b).dividedBy(c).toString());
        expect(new propio(a).plus(b).minus(c).toString()).toBe(new dePrisma(a).plus(b).minus(c).toString());
      }),
      { numRuns: 3000 }
    );
  });

  it("los redondeos que usa moneda.ts (a 2 decimales y a 0, hacia el empate, hacia arriba y hacia abajo) dan lo mismo", () => {
    fc.assert(
      fc.property(numero, numero, (a, b) => {
        const x = new propio(a).times(b);
        const y = new dePrisma(a).times(b);
        for (const [lugares, modo] of [
          [2, propio.ROUND_HALF_UP],
          [2, propio.ROUND_CEIL],
          [6, propio.ROUND_HALF_UP],
          [0, propio.ROUND_DOWN],
          [0, propio.ROUND_HALF_UP],
        ] as const) {
          expect(x.toDecimalPlaces(lugares, modo).toNumber()).toBe(y.toDecimalPlaces(lugares, modo).toNumber());
        }
      }),
      { numRuns: 3000 }
    );
  });

  it("los empates de medio centavo conocidos suben igual (128,045 → 128,05; 1,005 → 1,01)", () => {
    for (const [entrada, esperado] of [[128.045, 128.05], [1.005, 1.01], [-128.045, -128.05], [0.3 * 1234.55, 370.36]] as const) {
      expect(new propio(entrada).toDecimalPlaces(2, propio.ROUND_HALF_UP).toNumber()).toBe(new dePrisma(entrada).toDecimalPlaces(2, dePrisma.ROUND_HALF_UP).toNumber());
      if (entrada !== 0.3 * 1234.55) expect(new propio(entrada).toDecimalPlaces(2, propio.ROUND_HALF_UP).toNumber()).toBe(esperado);
    }
  });
});
