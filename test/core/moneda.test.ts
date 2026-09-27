import { describe, expect, it } from "vitest";
import { importeDeLinea, redondearMoneda, repartirImporte, totalDeLineas } from "../../src/core/moneda";

/**
 * Tests puros de src/core/moneda.ts (sin base). Los valores esperados son los de `round(v::numeric, 2)` de Postgres: empates de medio
 * centavo alejándose del cero, también cuando el x,xx5 no es exacto en binario (el caso que `Math.round(n * 100) / 100` redondeaba mal).
 */
describe("moneda — redondearMoneda", () => {
  it("empates x,xx5 que no son exactos en binario suben (128,045 → 128,05; 1,005 → 1,01)", () => {
    expect(redondearMoneda(128.045)).toBe(128.05);
    expect(redondearMoneda(1.005)).toBe(1.01);
    expect(redondearMoneda(1.015)).toBe(1.02);
    expect(redondearMoneda(8.345)).toBe(8.35);
  });

  it("negativos: el empate se aleja del cero, igual que NUMERIC (-128,045 → -128,05)", () => {
    expect(redondearMoneda(-128.045)).toBe(-128.05);
    expect(redondearMoneda(-1.005)).toBe(-1.01);
    expect(redondearMoneda(-10.125)).toBe(-10.13);
  });

  it("nunca devuelve -0 (un saldo pagado con restos de float se muestra $ 0,00)", () => {
    expect(Object.is(redondearMoneda(0.3 - (0.1 + 0.2)), 0)).toBe(true);
    expect(Object.is(redondearMoneda(-0), 0)).toBe(true);
    expect(Object.is(redondearMoneda(-0.004), 0)).toBe(true);
  });

  it("regresiones que ya andaban: empate exacto en binario, enteros y valores sin empate", () => {
    expect(redondearMoneda(10.125)).toBe(10.13);
    expect(redondearMoneda(9000)).toBe(9000);
    expect(redondearMoneda(33500)).toBe(33500);
    expect(redondearMoneda(1500.15)).toBe(1500.15);
    expect(redondearMoneda(14.3775)).toBe(14.38);
    expect(redondearMoneda(10.01 / 3)).toBe(3.34);
    expect(redondearMoneda(0.1 + 0.2)).toBe(0.3);
  });

  it("NaN e ±Infinity pasan igual que con Math.round", () => {
    expect(redondearMoneda(Number.NaN)).toBeNaN();
    expect(redondearMoneda(Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY);
    expect(redondearMoneda(Number.NEGATIVE_INFINITY)).toBe(Number.NEGATIVE_INFINITY);
  });
});

describe("moneda — importeDeLinea", () => {
  it("producto exacto y un solo redondeo (consignación 0,045 kg × $509 = 22,905 → 22,91)", () => {
    expect(importeDeLinea(0.045, 509)).toBe(22.91);
  });

  it("no se queda debajo del empate por el float (0,3 kg × $1.234,55 = 370,365 → 370,37)", () => {
    expect(0.3 * 1234.55).toBe(370.36499999999995); // lo que daba el float antes de redondear
    expect(importeDeLinea(0.3, 1234.55)).toBe(370.37);
  });

  it("regresiones: 2,5 × 4,05 = 10,125 → 10,13; 1,5 × 1000,1 = 1500,15; 4,5 × 3,195 = 14,3775 → 14,38; enteros", () => {
    expect(importeDeLinea(2.5, 4.05)).toBe(10.13);
    expect(importeDeLinea(1.5, 1000.1)).toBe(1500.15);
    expect(importeDeLinea(4.5, 3.195)).toBe(14.38);
    expect(importeDeLinea(3, 9000)).toBe(27000);
    expect(importeDeLinea(0, 1234.55)).toBe(0);
  });

  it("negativos: el espejo del positivo, sin -0", () => {
    expect(importeDeLinea(-0.3, 1234.55)).toBe(-370.37);
    expect(importeDeLinea(-0.045, 509)).toBe(-22.91);
    expect(Object.is(importeDeLinea(-2, 0), 0)).toBe(true);
    expect(Object.is(importeDeLinea(-0.5, 0), 0)).toBe(true);
  });

  it("NaN e ±Infinity pasan igual que hoy", () => {
    expect(importeDeLinea(Number.NaN, 10)).toBeNaN();
    expect(importeDeLinea(2, Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY);
    expect(importeDeLinea(-2, Number.POSITIVE_INFINITY)).toBe(Number.NEGATIVE_INFINITY);
  });
});

describe("moneda — totalDeLineas", () => {
  it("suma exacta y un solo redondeo al final", () => {
    expect(totalDeLineas([])).toBe(0);
    expect(totalDeLineas([{ cantidad: 0.3, precioUnitario: 1234.55 }])).toBe(370.37);
    // 370,365 + 22,905 = 393,27 exacto (sin redondear por línea).
    expect(
      totalDeLineas([
        { cantidad: 0.3, precioUnitario: 1234.55 },
        { cantidad: 0.045, precioUnitario: 509 },
      ])
    ).toBe(393.27);
    expect(
      totalDeLineas([
        { cantidad: 2, precioUnitario: 9000 },
        { cantidad: 1, precioUnitario: 9500 },
      ])
    ).toBe(27500);
  });

  it("espejos negativos (anulaciones) se cancelan exacto, sin -0", () => {
    const total = totalDeLineas([
      { cantidad: 0.3, precioUnitario: 1234.55 },
      { cantidad: -0.3, precioUnitario: 1234.55 },
    ]);
    expect(Object.is(total, 0)).toBe(true);
    expect(
      totalDeLineas([
        { cantidad: 1.5, precioUnitario: 1234.55 },
        { cantidad: -0.3, precioUnitario: 1234.55 },
      ])
    ).toBe(1481.46); // 1,2 × 1234,55 = 1481,46
  });

  it("NaN e ±Infinity pasan igual que hoy", () => {
    expect(totalDeLineas([{ cantidad: Number.NaN, precioUnitario: 1 }])).toBeNaN();
    expect(totalDeLineas([{ cantidad: 1, precioUnitario: Number.POSITIVE_INFINITY }])).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("moneda — repartirImporte (Task #16, largest remainder)", () => {
  it("divide exacto cuando el importe es múltiplo de los pesos", () => {
    expect(repartirImporte(100, [1, 1])).toEqual([50, 50]);
    expect(repartirImporte(30, [1, 2])).toEqual([10, 20]);
  });

  it("la suma de las partes da SIEMPRE, exacto, el importe pedido — también cuando no divide parejo", () => {
    expect(repartirImporte(10, [1, 1, 1])).toEqual([3.34, 3.33, 3.33]);
    expect(
      repartirImporte(10, [1, 1, 1]).reduce((s, v) => s + v, 0)
    ).toBe(10);
    const partes = repartirImporte(6543.21, [1234.55, 987.33, 501, 2]);
    expect(Math.round(partes.reduce((s, v) => s + v, 0) * 100) / 100).toBe(6543.21);
  });

  it("determinístico: a igual resto, gana el índice más bajo", () => {
    // Tres pesos iguales: los restos fraccionarios son idénticos, el orden de desempate decide quién se lleva el centavo extra.
    expect(repartirImporte(10, [1, 1, 1])).toEqual(repartirImporte(10, [1, 1, 1]));
    expect(repartirImporte(10, [1, 1, 1])[0]).toBe(3.34);
  });

  it("pesos todos en 0 (o vacíos de peso): reparte en partes iguales", () => {
    expect(repartirImporte(10, [0, 0])).toEqual([5, 5]);
    expect(repartirImporte(9, [0, 0, 0])).toEqual([3, 3, 3]);
  });

  it("un peso negativo o no finito se trata como 0", () => {
    expect(repartirImporte(10, [1, -5])).toEqual(repartirImporte(10, [1, 0]));
  });

  it("sin partes, devuelve []", () => {
    expect(repartirImporte(100, [])).toEqual([]);
  });

  it("importe negativo o no finito: NaN en cada parte (no hay reparto sensato)", () => {
    expect(repartirImporte(-10, [1, 1]).every(Number.isNaN)).toBe(true);
    expect(repartirImporte(Number.NaN, [1, 1]).every(Number.isNaN)).toBe(true);
  });

  it("importe 0: todas las partes en 0, sin -0", () => {
    const partes = repartirImporte(0, [1, 2, 3]);
    expect(partes).toEqual([0, 0, 0]);
    expect(partes.every((v) => Object.is(v, 0))).toBe(true);
  });
});
