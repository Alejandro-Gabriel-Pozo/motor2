import { describe, expect, it } from "vitest";
import { FOOD_COST_OBJETIVO_PCT, precioParaObjetivo, resolverObjetivoFoodCost, superaFoodCostObjetivo } from "../../src/core/reportes/margen-objetivo";

describe("FOOD_COST_OBJETIVO_PCT", () => {
  it("es 40 (decisión del dueño, 2026-10-01)", () => {
    expect(FOOD_COST_OBJETIVO_PCT).toBe(40);
  });
});

describe("resolverObjetivoFoodCost: categoría > empresa > constante", () => {
  const objetivos = (empresaPct: number | null, categorias: Array<[string, number]> = []) => ({ empresaPct, porCategoria: new Map(categorias) });

  it("sin objetivos cargados rige la constante", () => {
    expect(resolverObjetivoFoodCost(undefined, "cat-1")).toBe(FOOD_COST_OBJETIVO_PCT);
    expect(resolverObjetivoFoodCost(objetivos(null), "cat-1")).toBe(FOOD_COST_OBJETIVO_PCT);
    expect(resolverObjetivoFoodCost(objetivos(null), null)).toBe(FOOD_COST_OBJETIVO_PCT);
  });

  it("el de la empresa rige para toda categoría que no tiene el suyo y para un producto sin categoría", () => {
    expect(resolverObjetivoFoodCost(objetivos(35), "cat-1")).toBe(35);
    expect(resolverObjetivoFoodCost(objetivos(35), null)).toBe(35);
    expect(resolverObjetivoFoodCost(objetivos(35), undefined)).toBe(35);
  });

  it("el de la categoría gana sobre el de la empresa, aunque sea más alto", () => {
    expect(resolverObjetivoFoodCost(objetivos(35, [["cat-1", 25]]), "cat-1")).toBe(25);
    expect(resolverObjetivoFoodCost(objetivos(35, [["cat-1", 55.5]]), "cat-1")).toBe(55.5);
    expect(resolverObjetivoFoodCost(objetivos(35, [["cat-1", 25]]), "cat-2")).toBe(35);
  });

  it("el de la categoría rige aunque la empresa no cargue ninguno", () => {
    expect(resolverObjetivoFoodCost(objetivos(null, [["cat-1", 25]]), "cat-1")).toBe(25);
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

  it("redondea a centavos HACIA ARRIBA: es el precio mínimo que cumple el objetivo", () => {
    expect(precioParaObjetivo(1000, 30)).toBe(3333.34); // 3333,333… → 3333,34 (con 3333,33 el food cost daría 30,0003 %)
    expect(precioParaObjetivo(1, 30)).toBe(3.34); // 3,333… → 3,34
    expect(precioParaObjetivo(0.01, 40)).toBe(0.03); // 0,025 → 0,03
  });

  it("un resultado que ya es exacto en centavos no sube (12,5 no pasa a 12,51)", () => {
    expect(precioParaObjetivo(5, 40)).toBe(12.5);
    expect(precioParaObjetivo(0.3, 40)).toBe(0.75);
    expect(precioParaObjetivo(1.2, 40)).toBe(3);
  });

  it("el ruido de coma flotante del costo no empuja un centavo de más", () => {
    expect(precioParaObjetivo(4.000000000000001)).toBe(10);
    expect(precioParaObjetivo(0.1 + 0.2, 40)).toBe(0.75);
    expect(precioParaObjetivo(9.999999999999998)).toBe(25);
  });

  it("un costo diminuto da al menos un centavo", () => {
    expect(precioParaObjetivo(0.000001)).toBe(0.01);
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
