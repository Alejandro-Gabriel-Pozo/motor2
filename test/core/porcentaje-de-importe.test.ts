import { Decimal } from "decimal.js";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { porcentajeDeImporte } from "../../src/core/moneda";

/**
 * `porcentajeDeImporte` (GO-0b): `importe × porcentaje ÷ 100` en decimal exacto, UN solo redondeo al centavo, mitad hacia arriba (alejándose del cero). Es la cuenta del
 * «porcentaje de diferencia» de una opción de venta. El oráculo de las propiedades es decimal.js con la misma regla, escrito acá aparte, nunca en float.
 */

const RUNS = { numRuns: 1000 };
/** `+ 0` normaliza el -0 (decimal.js lo conserva; el módulo no). */
const oraculo = (importe: number, porcentaje: number): number => new Decimal(importe).times(porcentaje).dividedBy(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber() + 0;

/** Importes de 2 decimales (hasta 10 millones) y porcentajes de 4 decimales (de -99,9999 a 999,9999): lo que admiten `DECIMAL(14,2)` y `DECIMAL(7,4)`. */
const importeArb = fc.integer({ min: 0, max: 1_000_000_000 }).map((c) => c / 100);
const porcentajeArb = fc.integer({ min: -999_999, max: 9_999_999 }).map((m) => m / 10_000);

describe("porcentajeDeImporte: casos puntuales", () => {
  it("un porcentaje redondo da el monto exacto", () => {
    expect(porcentajeDeImporte(3000, 8.5)).toBe(255);
    expect(porcentajeDeImporte(20000, 12.5)).toBe(2500);
    expect(porcentajeDeImporte(100, 10)).toBe(10);
    expect(porcentajeDeImporte(0, 50)).toBe(0);
    expect(porcentajeDeImporte(500, 0)).toBe(0);
  });

  it("los empates de medio centavo suben (50,005 → 50,01), también los que en float quedan apenas abajo", () => {
    expect(porcentajeDeImporte(1000.1, 5)).toBe(50.01);
    expect(porcentajeDeImporte(0.1, 5)).toBe(0.01);
    expect(porcentajeDeImporte(1.15, 10)).toBe(0.12); // 0,115 exacto; en float 1.15 * 10 / 100 da 0,11499999…
    expect(porcentajeDeImporte(128.045, 100)).toBe(128.05);
  });

  it("el porcentaje con decimales no se contamina con el ruido de dividir por 100 en float (7,1 % de 100 = 7,10)", () => {
    expect(porcentajeDeImporte(100, 7.1)).toBe(7.1);
    expect(porcentajeDeImporte(2000, 0.0001)).toBe(0);
    expect(porcentajeDeImporte(5_000_000, 0.0001)).toBe(5);
  });

  it("es simétrico: el opuesto del importe o del porcentaje da el opuesto exacto (una rebaja redondea igual que un recargo)", () => {
    expect(porcentajeDeImporte(1000.1, -5)).toBe(-50.01);
    expect(porcentajeDeImporte(-1000.1, 5)).toBe(-50.01);
    expect(porcentajeDeImporte(-1000.1, -5)).toBe(50.01);
  });

  it("nunca devuelve -0", () => {
    expect(Object.is(porcentajeDeImporte(0, -10), 0)).toBe(true);
    expect(Object.is(porcentajeDeImporte(0.01, -1), 0)).toBe(true);
  });

  it("un dato que no es finito da NaN (no inventa un monto)", () => {
    expect(porcentajeDeImporte(Number.NaN, 5)).toBeNaN();
    expect(porcentajeDeImporte(100, Number.POSITIVE_INFINITY)).toBeNaN();
    expect(porcentajeDeImporte(Number.NEGATIVE_INFINITY, 5)).toBeNaN();
  });
});

describe("porcentajeDeImporte (propiedades)", () => {
  it("coincide con el oráculo decimal.js para cualquier importe de 2 decimales y porcentaje de 4", () => {
    fc.assert(
      fc.property(importeArb, porcentajeArb, (importe, porcentaje) => {
        expect(porcentajeDeImporte(importe, porcentaje)).toBe(oraculo(importe, porcentaje));
      }),
      RUNS
    );
  });

  it("es simétrico en el importe y en el porcentaje", () => {
    fc.assert(
      fc.property(importeArb, porcentajeArb, (importe, porcentaje) => {
        const directo = porcentajeDeImporte(importe, porcentaje);
        expect(porcentajeDeImporte(-importe, porcentaje)).toBe(directo === 0 ? 0 : -directo);
        expect(porcentajeDeImporte(importe, -porcentaje)).toBe(directo === 0 ? 0 : -directo);
      }),
      RUNS
    );
  });

  it("el resultado ya es de 2 decimales (redondear de nuevo no lo mueve) y es estable", () => {
    fc.assert(
      fc.property(importeArb, porcentajeArb, (importe, porcentaje) => {
        const r = porcentajeDeImporte(importe, porcentaje);
        expect(new Decimal(r).decimalPlaces()).toBeLessThanOrEqual(2);
        expect(porcentajeDeImporte(importe, porcentaje)).toBe(r);
      }),
      RUNS
    );
  });

  it("está a menos de medio centavo del valor exacto", () => {
    fc.assert(
      fc.property(importeArb, porcentajeArb, (importe, porcentaje) => {
        const exacto = new Decimal(importe).times(porcentaje).dividedBy(100);
        expect(new Decimal(porcentajeDeImporte(importe, porcentaje)).minus(exacto).abs().lte("0.005")).toBe(true);
      }),
      RUNS
    );
  });
});
