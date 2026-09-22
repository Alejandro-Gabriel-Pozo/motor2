import { describe, expect, it } from "vitest";
import { mediana } from "../../src/core/estadistica/mediana";

describe("mediana", () => {
  it("con cantidad impar de elementos, devuelve el del medio", () => {
    expect(mediana([5, 1, 3])).toBe(3);
  });

  it("con cantidad par de elementos, promedia los dos centrales", () => {
    expect(mediana([1, 2, 3, 4])).toBe(2.5);
  });

  it("lista vacía: null (no hay 'cantidad típica' sin datos)", () => {
    expect(mediana([])).toBeNull();
  });

  it("un solo elemento: ese elemento", () => {
    expect(mediana([42])).toBe(42);
  });

  it("resiste un valor atípico (el stock inicial) que distorsionaría el promedio", () => {
    // 9 compras de 25kg + 1 carga inicial de 500kg: el promedio (68.2) no representa nada; la mediana sí.
    const valores = [25, 25, 25, 25, 25, 25, 25, 25, 25, 500];
    expect(mediana(valores)).toBe(25);
  });

  it("no muta la lista de entrada", () => {
    const valores = [3, 1, 2];
    mediana(valores);
    expect(valores).toEqual([3, 1, 2]);
  });
});
