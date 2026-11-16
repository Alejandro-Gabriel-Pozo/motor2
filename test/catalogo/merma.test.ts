import { Decimal } from "decimal.js";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { factorDeMerma, factorDeMermaExacto } from "@/core/catalogo/public";

/**
 * M0 del diseño de merma (`docs/diseno-merma-sobre-bruto-como-pedernal-2026-11-15.md`, DT-M2): la función única da EXACTAMENTE lo mismo, bit a bit, que la expresión que había escrita a mano en
 * nueve lugares. Las expresiones viejas se copian TEXTUALES acá abajo (son el oráculo: no se importan de ningún lado) y se comparan en una grilla de merma de 0 a 100 con paso 0,01 y con propiedades.
 */
const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

/** Todas las mermas de 0,00 a 100,00 con paso 0,01 (los valores que acepta la columna `Decimal(5,2)` hoy), tal como llegan: `Number("12.34")`. */
const MERMAS = Array.from({ length: 10001 }, (_, i) => Number((i / 100).toFixed(2)));
const CANTIDADES = [0.001, 0.1, 1 / 3, 0.7, 1, 2.5, 7, 300, 1250.5, 12345.6789, 1e-7];

describe("factorDeMerma (number): idéntico a la expresión vieja", () => {
  it("en la grilla de merma 0 a 100 (paso 0,01), el factor es el mismo número bit a bit", () => {
    for (const m of MERMAS) expect(Object.is(factorDeMerma(m), 1 + m / 100), `merma ${m}`).toBe(true);
  });

  it("venta y producción: cantidad × rendimiento × factor, en el mismo orden, da lo mismo bit a bit", () => {
    for (const m of MERMAS) {
      for (const c of CANTIDADES) {
        const rendimiento = c * 0.37;
        expect(Object.is(c * rendimiento * factorDeMerma(m), c * rendimiento * (1 + m / 100)), `${c} × ${rendimiento} × merma ${m}`).toBe(true);
      }
    }
  });

  it("costos: cantidad × factor × costo, y la cantidad con merma, dan lo mismo bit a bit", () => {
    for (const m of MERMAS) {
      for (const c of CANTIDADES) {
        expect(Object.is(c * factorDeMerma(m) * 1234.56, c * (1 + m / 100) * 1234.56)).toBe(true);
        expect(Object.is(c * factorDeMerma(m), c * (1 + m / 100))).toBe(true);
      }
    }
  });

  it("reporte de rendimiento: la multiplicación y la división inversa dan lo mismo bit a bit", () => {
    for (const m of MERMAS) {
      for (const c of CANTIDADES) {
        expect(Object.is(c * factorDeMerma(m), c * (1 + m / 100))).toBe(true);
        expect(Object.is(c / factorDeMerma(m), c / (1 + m / 100))).toBe(true);
      }
    }
  });

  it("propiedad: para cualquier merma y cantidad finitas (también fuera de 0 a 100), lo mismo bit a bit", () => {
    fc.assert(
      fc.property(fc.double({ noNaN: true, noDefaultInfinity: true, min: -1000, max: 1000 }), fc.double({ noNaN: true, noDefaultInfinity: true, min: 0, max: 1e9 }), (m, c) => {
        return Object.is(factorDeMerma(m), 1 + m / 100) && Object.is(c * factorDeMerma(m), c * (1 + m / 100)) && Object.is(c / factorDeMerma(m), c / (1 + m / 100));
      }),
      { numRuns: 2000 }
    );
  });
});

describe("factorDeMermaExacto (decimal.js): idéntico a la expresión vieja", () => {
  it("en la grilla de merma 0 a 100 (paso 0,01), el factor es el mismo decimal (mismo texto y mismo número)", () => {
    for (const m of MERMAS) {
      const viejo = new D(1).plus(new D(m).dividedBy(100));
      expect(factorDeMermaExacto(m).toString(), `merma ${m}`).toBe(viejo.toString());
      expect(factorDeMermaExacto(m).toNumber()).toBe(viejo.toNumber());
    }
  });

  it("el consumo de la línea configurada (unidades × cantidad × factor × merma) da el mismo decimal y el mismo number", () => {
    for (const m of MERMAS.filter((_, i) => i % 7 === 0)) {
      for (const c of CANTIDADES) {
        const viejo = new D(3).times(c).times(1.5).times(new D(1).plus(new D(m).dividedBy(100)));
        const nuevo = new D(3).times(c).times(1.5).times(factorDeMermaExacto(m));
        expect(nuevo.toString()).toBe(viejo.toString());
        expect(Object.is(nuevo.toNumber(), viejo.toNumber())).toBe(true);
      }
    }
  });

  it("acepta la merma como texto o como Decimal, igual que `new D(merma)`", () => {
    expect(factorDeMermaExacto("12.5").toString()).toBe("1.125");
    expect(factorDeMermaExacto(new Decimal("12.5")).toString()).toBe("1.125");
  });
});
