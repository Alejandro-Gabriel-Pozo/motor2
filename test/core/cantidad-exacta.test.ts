import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { DECIMALES_DE_CANTIDAD, MAXIMO_DE_DECIMALES, redondearCantidadExacta } from "@/core/datos/cantidad-exacta";

/**
 * Oráculo de `redondearCantidadExacta` (frente 3, E-1b). El oráculo es independiente del código: la división entera con empate alejándose del cero de Pedernal
 * (`dividirRedondeando(..., "MITAD_SUBE_SIMETRICA")`, `src/primitivas/cantidad/redondeo-entero.ts`), reescrita acá con `bigint`. Casos fijos (los del encabezado de la primitiva), propiedades con
 * `fast-check`, y el contraste con `redondearACantidadDeUnidad` (`Math.round`) que muestra qué cambia y qué no.
 */

/** El redondeo anterior (`Math.round` en coma flotante), copiado acá como referencia: no depende de `transiciones.ts`, que cambia en el carril del frente 2. */
const redondearConMathRound = (cantidad: number, decimales: number): number => Math.round(cantidad * 10 ** decimales) / 10 ** decimales;

/** `numerador / denominador` a entero, empate alejándose del cero. Denominador positivo. */
function dividirAlejandoDelCero(numerador: bigint, denominador: bigint): bigint {
  const negativo = numerador < BigInt(0);
  const absoluto = negativo ? -numerador : numerador;
  const entero = absoluto / denominador;
  const sube = (absoluto % denominador) * BigInt(2) >= denominador;
  const redondeado = sube ? entero + BigInt(1) : entero;
  return negativo ? -redondeado : redondeado;
}

/** El valor `numerador / 10^escala` como `number` (la representación decimal más corta, la que teclea una persona). */
function valorDe(numerador: bigint, escala: number): number {
  return Number(`${numerador}e-${escala}`);
}

describe("redondearCantidadExacta: casos fijos", () => {
  it.each([
    [1.005, 2, 1.01],
    [128.045, 2, 128.05],
    [0.3 * 3, 1, 0.9],
    [0.1 + 0.2, 4, 0.3],
    [10.00005, 4, 10.0001],
    [-10.00005, 4, -10.0001],
    [-0.125, 2, -0.13],
    [0.125, 2, 0.13],
    [2.5, 0, 3],
    [-2.5, 0, -3],
    [1234.56789, 4, 1234.5679],
    [1234.56784, 4, 1234.5678],
    [7, 0, 7],
    [7, 4, 7],
  ])("redondearCantidadExacta(%s, %s) = %s", (cantidad, decimales, esperado) => {
    expect(redondearCantidadExacta(cantidad, decimales)).toBe(esperado);
  });

  it("sin decimales usa 4, la escala fija de la cantidad", () => {
    expect(DECIMALES_DE_CANTIDAD).toBe(4);
    expect(MAXIMO_DE_DECIMALES).toBe(8);
    expect(redondearCantidadExacta(1.23455)).toBe(1.2346);
    expect(redondearCantidadExacta(1.23454)).toBe(1.2345);
  });

  it("acepta hasta 8 decimales como parámetro (cálculo intermedio) y el valor se conserva", () => {
    expect(redondearCantidadExacta(0.123456785, 8)).toBe(0.12345679);
    expect(redondearCantidadExacta(0.123456784, 8)).toBe(0.12345678);
  });

  it("normaliza -0 a 0", () => {
    expect(Object.is(redondearCantidadExacta(-0.00001), 0)).toBe(true);
    expect(Object.is(redondearCantidadExacta(-0), 0)).toBe(true);
  });
});

describe("redondearCantidadExacta: falla cerrada", () => {
  it.each([[Number.NaN], [Number.POSITIVE_INFINITY], [Number.NEGATIVE_INFINITY]])("la cantidad %s se rechaza", (cantidad) => {
    expect(() => redondearCantidadExacta(cantidad, 2)).toThrow(RangeError);
  });

  it.each([[-1], [9], [1.5], [Number.NaN], [Number.POSITIVE_INFINITY]])("los decimales %s se rechazan", (decimales) => {
    expect(() => redondearCantidadExacta(1, decimales)).toThrow(RangeError);
  });
});

describe("redondearCantidadExacta: propiedades contra el oráculo de enteros", () => {
  const RUNS = { numRuns: 2000 };

  it("coincide con la división entera de Pedernal en cualquier valor de hasta 8 decimales", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -(BigInt(10) ** BigInt(14)), max: BigInt(10) ** BigInt(14) }), fc.integer({ min: 0, max: 4 }), (n, decimales) => {
        const esperado = valorDe(dividirAlejandoDelCero(n, BigInt(10) ** BigInt(8 - decimales)), decimales);
        expect(redondearCantidadExacta(valorDe(n, 8), decimales)).toBe(esperado === 0 ? 0 : esperado);
      }),
      RUNS,
    );
  });

  it("es idempotente: redondear dos veces es redondear una", () => {
    fc.assert(
      fc.property(fc.double({ min: -1e9, max: 1e9, noNaN: true }), fc.integer({ min: 0, max: 4 }), (x, d) => {
        const una = redondearCantidadExacta(x, d);
        expect(redondearCantidadExacta(una, d)).toBe(una);
      }),
      RUNS,
    );
  });

  it("es simétrica: el redondeo de −x es el opuesto del de x", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1e9, noNaN: true }), fc.integer({ min: 0, max: 4 }), (x, d) => {
        const mas = redondearCantidadExacta(x, d);
        const menos = redondearCantidadExacta(-x, d);
        expect(menos === 0 ? 0 : menos).toBe(mas === 0 ? 0 : -mas);
      }),
      RUNS,
    );
  });

  it("nunca se aleja del valor más de media unidad de la última cifra", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -(BigInt(10) ** BigInt(12)), max: BigInt(10) ** BigInt(12) }), fc.integer({ min: 0, max: 4 }), (n, d) => {
        const x = valorDe(n, 6);
        const r = redondearCantidadExacta(x, d);
        expect(Math.abs(r - x)).toBeLessThanOrEqual(0.5 * 10 ** -d + 1e-9);
      }),
      RUNS,
    );
  });

  it("es monótona: un valor mayor nunca da un resultado menor", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -(BigInt(10) ** BigInt(12)), max: BigInt(10) ** BigInt(12) }), fc.bigInt({ min: BigInt(0), max: BigInt(10) ** BigInt(6) }), fc.integer({ min: 0, max: 4 }), (n, delta, d) => {
        expect(redondearCantidadExacta(valorDe(n + delta, 6), d)).toBeGreaterThanOrEqual(redondearCantidadExacta(valorDe(n, 6), d));
      }),
      RUNS,
    );
  });
});

describe("redondearCantidadExacta frente al redondeo anterior (Math.round): qué cambia y qué no", () => {
  it("con valores que no son empate coincide", () => {
    for (const [x, d] of [[1.2344, 2], [1.2346, 2], [10, 4], [0.5001, 0], [3.14159, 4]] as const) {
      expect(redondearCantidadExacta(x, d)).toBe(redondearConMathRound(x, d));
    }
  });

  it("corrige el empate positivo que el flotante dejaba apenas por debajo", () => {
    expect(redondearConMathRound(1.005, 2)).toBe(1);
    expect(redondearCantidadExacta(1.005, 2)).toBe(1.01);
  });

  it("cambia el empate NEGATIVO exacto: antes hacia +∞, ahora alejándose del cero (diferencia declarada)", () => {
    expect(redondearConMathRound(-0.125, 2)).toBe(-0.12);
    expect(redondearCantidadExacta(-0.125, 2)).toBe(-0.13);
  });
});
