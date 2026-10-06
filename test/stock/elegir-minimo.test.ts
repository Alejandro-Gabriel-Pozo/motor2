import { describe, expect, it } from "vitest";
import { elegirMinimo } from "../../src/core/stock/stock-minimo";

describe("elegirMinimo: prioridad sección > global > sin mínimo", () => {
  it("gana el de la sección sobre el global", () => {
    expect(elegirMinimo(3, 10)).toBe(3);
  });

  it("sin mínimo de sección, vale el global", () => {
    expect(elegirMinimo(null, 10)).toBe(10);
    expect(elegirMinimo(undefined, 10)).toBe(10);
  });

  it("un 0 es un mínimo real: gana sobre el global (no se trata como ausente)", () => {
    expect(elegirMinimo(0, 10)).toBe(0);
    expect(elegirMinimo(null, 0)).toBe(0);
  });

  it("sin ninguno, null (sin mínimo cargado: no hay alerta)", () => {
    expect(elegirMinimo(null, null)).toBeNull();
    expect(elegirMinimo(undefined, undefined)).toBeNull();
  });
});
