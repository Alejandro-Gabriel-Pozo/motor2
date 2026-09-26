import { describe, expect, it } from "vitest";
import { cumplePaso, mensajeCantidadNoCumplePaso, validarPasoVenta } from "../../src/core/catalogo/venta-fraccionada";

/** Núcleo puro de venta fraccionada (src/core/catalogo/venta-fraccionada.ts, Task #25, docs/plan-venta-fraccionada-2026-09-26.md). */

describe("cumplePaso", () => {
  it("un múltiplo exacto cumple, tolerando el ruido de punto flotante (0,1 × 3)", () => {
    expect(cumplePaso(0.5, 0.5)).toBe(true);
    expect(cumplePaso(1, 0.5)).toBe(true);
    expect(cumplePaso(2.5, 0.5)).toBe(true);
    expect(cumplePaso(0.3, 0.1)).toBe(true); // 0.1 + 0.1 + 0.1 !== 0.3 en binario
    expect(cumplePaso(0.75, 0.25)).toBe(true);
    expect(cumplePaso(0.125, 0.125)).toBe(true);
  });

  it("lo que no es múltiplo no cumple", () => {
    expect(cumplePaso(0.3, 0.5)).toBe(false);
    expect(cumplePaso(0.6, 0.25)).toBe(false);
    expect(cumplePaso(1.1, 0.5)).toBe(false);
  });

  it("un paso inválido (cero, negativo, no finito) nunca cumple", () => {
    expect(cumplePaso(1, 0)).toBe(false);
    expect(cumplePaso(1, -0.5)).toBe(false);
    expect(cumplePaso(1, Number.NaN)).toBe(false);
  });
});

describe("validarPasoVenta", () => {
  const sinStockReal = { decimalesUnidad: 0, tieneStockReal: false };
  const conStockReal = (decimalesUnidad: number) => ({ decimalesUnidad, tieneStockReal: true });

  it("acepta 0,5 / 0,25 / 0,2 / 0,125 / 0,1 (1/paso entero) sin stock real, sin importar los decimales de la unidad", () => {
    for (const paso of [0.5, 0.25, 0.2, 0.125, 0.1]) {
      expect(validarPasoVenta(paso, sinStockReal)).toEqual({ ok: true, paso });
    }
  });

  it("rechaza 0,3, 0, 1,5, negativos y no números", () => {
    for (const invalido of [0.3, 0, -0.5, 1.5, Number.NaN, "0,5" as unknown as number, null, undefined]) {
      expect(validarPasoVenta(invalido, sinStockReal).ok, String(invalido)).toBe(false);
    }
  });

  it("1 vale (comportamiento actual, «una unidad entera por línea»)", () => {
    expect(validarPasoVenta(1, sinStockReal)).toEqual({ ok: true, paso: 1 });
  });

  it("hasta 4 decimales: 0,0625 (1/16) es válido; algo con más de 4 decimales se rechaza", () => {
    expect(validarPasoVenta(0.0625, sinStockReal)).toEqual({ ok: true, paso: 0.0625 });
    expect(validarPasoVenta(0.33333, sinStockReal).ok).toBe(false);
  });

  describe("R3: el paso nunca amplía la precisión de algo con stock real", () => {
    it("sin stock real (no 'Se produce'), el paso es libre aunque la unidad tenga 0 decimales", () => {
      expect(validarPasoVenta(0.5, { decimalesUnidad: 0, tieneStockReal: false })).toEqual({ ok: true, paso: 0.5 });
      expect(validarPasoVenta(0.125, { decimalesUnidad: 0, tieneStockReal: false })).toEqual({ ok: true, paso: 0.125 });
    });

    it("con stock real, el paso entra si la unidad tiene decimales suficientes", () => {
      expect(validarPasoVenta(0.5, conStockReal(1))).toEqual({ ok: true, paso: 0.5 });
      expect(validarPasoVenta(0.25, conStockReal(2))).toEqual({ ok: true, paso: 0.25 });
      expect(validarPasoVenta(0.125, conStockReal(3))).toEqual({ ok: true, paso: 0.125 });
    });

    it("con stock real, se rechaza si la unidad no llega — mensaje sugiere una unidad propia", () => {
      const r = validarPasoVenta(0.5, conStockReal(0));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.mensaje).toMatch(/unidad propia/);

      expect(validarPasoVenta(0.25, conStockReal(1)).ok).toBe(false);
      expect(validarPasoVenta(0.125, conStockReal(2)).ok).toBe(false);
    });
  });
});

describe("mensajeCantidadNoCumplePaso", () => {
  it("nombra el paso con coma decimal", () => {
    expect(mensajeCantidadNoCumplePaso(0.5)).toBe("Se vende de a 0,5: la cantidad tiene que ser un múltiplo exacto.");
    expect(mensajeCantidadNoCumplePaso(0.25)).toBe("Se vende de a 0,25: la cantidad tiene que ser un múltiplo exacto.");
  });
});
