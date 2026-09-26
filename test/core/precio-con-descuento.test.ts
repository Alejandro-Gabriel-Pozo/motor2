import { describe, expect, it } from "vitest";
import { precioConDescuento } from "../../src/core/moneda";

/**
 * Tests puros de `precioConDescuento` (src/core/moneda.ts, Task #14 — docs/plan-clientes-descuento-2026-09-26.md, punto 6). Sin base.
 */
describe("moneda — precioConDescuento", () => {
  it("sin porcentaje (undefined/null/0) devuelve el precio de lista tal cual", () => {
    expect(precioConDescuento(1000, undefined)).toBe(1000);
    expect(precioConDescuento(1000, null)).toBe(1000);
    expect(precioConDescuento(1000, 0)).toBe(1000);
    expect(precioConDescuento(0, 10)).toBe(0);
  });

  it("aplica el % con un solo redondeo al centavo (1000 con 15% → 850; 999 con 10% → 899,10)", () => {
    expect(precioConDescuento(1000, 15)).toBe(850);
    expect(precioConDescuento(999, 10)).toBe(899.1);
  });

  it("empate de medio centavo se aleja del cero, igual que redondearMoneda (127 con 33% → 85,09; float puro daría 85,08999...)", () => {
    // 127 × 0.67 = 85.09 exacto en decimal; ver el caso de abajo con más decimales para el empate real.
    expect(precioConDescuento(127, 33)).toBe(85.09);
    // 850,05 exacto de por sí: 100.006 × (100-15)/100 = 85.0051 → empate de medio centavo, sube a 85,01.
    expect(precioConDescuento(100.006, 15)).toBe(85.01);
  });

  it("no se queda debajo del empate por el float (mismo espíritu que importeDeLinea)", () => {
    // 0.3 kg de lista a $1234,55 no aplica acá (es importeDeLinea) — pero un 30% de descuento sobre un precio con
    // decimales exactos en decimal, no en binario, tiene que redondear igual de bien:
    expect(precioConDescuento(1234.55, 30)).toBe(864.19); // 1234.55 × 0.7 = 864.185 → 864,19 (empate)
  });

  it("piso de 0,01: nunca da 0 con precioLista > 0, ni con un % altísimo", () => {
    expect(precioConDescuento(1, 99.99)).toBe(0.01);
    expect(precioConDescuento(0.01, 99)).toBe(0.01);
    expect(precioConDescuento(0.5, 99.9)).toBe(0.01);
  });

  it("precioLista <= 0 pasa sin piso ni cálculo (no es este módulo el que lo valida)", () => {
    expect(precioConDescuento(0, 50)).toBe(0);
    expect(precioConDescuento(-10, 50)).toBe(-10);
  });

  it("100% de descuento (fuera del rango que valida validarPorcentajeDescuento) igual respeta el piso, no da 0", () => {
    expect(precioConDescuento(1000, 100)).toBe(0.01);
  });

  it("NaN/±Infinity de porcentaje pasan como 'sin descuento' (no explota)", () => {
    expect(precioConDescuento(1000, Number.NaN)).toBe(1000);
    expect(precioConDescuento(1000, Number.POSITIVE_INFINITY)).toBe(1000);
  });
});
