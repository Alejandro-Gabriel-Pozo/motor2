import { describe, expect, it } from "vitest";
import { DECIMALES_FOOD_COST_OBJETIVO, validarFoodCostObjetivo } from "@/core/datos/food-cost-objetivo";

// Sin base de datos: validarFoodCostObjetivo es pura. La usa la acción `guardarMargenObjetivo`.
describe("validarFoodCostObjetivo", () => {
  it("2 decimales (Decimal(5,2))", () => {
    expect(DECIMALES_FOOD_COST_OBJETIVO).toBe(2);
  });

  it("vacío → null (sin objetivo propio)", () => {
    for (const v of [undefined, null, "", "   "]) expect(validarFoodCostObjetivo(v)).toEqual({ ok: true, valor: null });
  });

  it("acepta un % entre 0 y 100, hasta 2 decimales, y texto es-AR", () => {
    for (const n of [0.01, 25, 33.33, 40, 99.99]) expect(validarFoodCostObjetivo(n)).toEqual({ ok: true, valor: n });
    expect(validarFoodCostObjetivo("32,5")).toEqual({ ok: true, valor: 32.5 });
  });

  it.each([0, -1, -0.5, "0", "-10"])("rechaza %s (tiene que ser mayor que 0)", (v) => {
    expect(validarFoodCostObjetivo(v)).toMatchObject({ ok: false, codigo: "rango" });
  });

  it.each([100, 100.01, 150, "100"])("rechaza %s (tiene que ser menor que 100)", (v) => {
    expect(validarFoodCostObjetivo(v)).toMatchObject({ ok: false, codigo: "rango" });
  });

  it.each([12.345, 40.001, "33,333"])("rechaza %s: más de 2 decimales", (v) => {
    expect(validarFoodCostObjetivo(v)).toMatchObject({ ok: false, codigo: "decimales" });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, "abc", true, {}, []])("rechaza %s como formato inválido", (v) => {
    expect(validarFoodCostObjetivo(v)).toMatchObject({ ok: false, codigo: "formato" });
  });
});
