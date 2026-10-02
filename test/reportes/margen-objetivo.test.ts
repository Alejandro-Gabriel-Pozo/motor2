import { describe, expect, it } from "vitest";
import { FOOD_COST_OBJETIVO_PCT, precioParaObjetivo, superaFoodCostObjetivo } from "../../src/core/reportes/margen-objetivo";

describe("FOOD_COST_OBJETIVO_PCT", () => {
  it("es 40 (decisión del dueño, 2026-10-01)", () => {
    expect(FOOD_COST_OBJETIVO_PCT).toBe(40);
  });
});

describe("superaFoodCostObjetivo", () => {
  it("justo en el objetivo NO supera (la comparación es estricta)", () => {
    expect(superaFoodCostObjetivo(4000, 10000)).toBe(false);
  });

  it("un peso por encima del objetivo, sí", () => {
    expect(superaFoodCostObjetivo(4100, 10000)).toBe(true);
  });

  it("por debajo del objetivo, no", () => {
    expect(superaFoodCostObjetivo(3900, 10000)).toBe(false);
  });

  it("usa el objetivo recibido en vez del de por defecto", () => {
    expect(superaFoodCostObjetivo(3500, 10000, 30)).toBe(true);
    expect(superaFoodCostObjetivo(3500, 10000, 35)).toBe(false);
  });

  it("no tiene error de coma flotante en el borde (0,1 + 0,2 sobre 0,75)", () => {
    expect(superaFoodCostObjetivo(0.3, 0.75)).toBe(false); // 0,3 ÷ 0,75 = 40 % exacto
  });
});

describe("precioParaObjetivo", () => {
  it("el precio con el que el costo de comida queda justo en el objetivo", () => {
    expect(precioParaObjetivo(4000)).toBe(10000);
    expect(precioParaObjetivo(1000)).toBe(2500);
  });

  it("redondea a centavos", () => {
    expect(precioParaObjetivo(1000, 30)).toBe(3333.33);
  });

  it("usa el objetivo recibido", () => {
    expect(precioParaObjetivo(300, 30)).toBe(1000);
  });

  it("sin costo de comida conocido no hay precio sugerido", () => {
    expect(precioParaObjetivo(null)).toBeNull();
    expect(precioParaObjetivo(0)).toBeNull();
    expect(precioParaObjetivo(-5)).toBeNull();
  });

  it("un objetivo fuera de 0–100 no tiene sentido", () => {
    expect(precioParaObjetivo(100, 0)).toBeNull();
    expect(precioParaObjetivo(100, 100)).toBeNull();
    expect(precioParaObjetivo(100, 130)).toBeNull();
    expect(precioParaObjetivo(100, Number.NaN)).toBeNull();
  });

  it("el precio sugerido nunca supera el objetivo (consistente con superaFoodCostObjetivo)", () => {
    for (const costo of [10, 37.5, 1234, 99999]) {
      const precio = precioParaObjetivo(costo)!;
      expect(superaFoodCostObjetivo(costo, precio)).toBe(false);
    }
  });
});
