import { describe, expect, it } from "vitest";
import { centavosDeImporte, mismosCentavos } from "@/core/datos/importe";

// Sin base de datos: la regla única para COMPARAR dinero del control del valor visto (ola «precio y carta», Fase 2, paso A0).
describe("mismosCentavos / centavosDeImporte", () => {
  it("compara al centavo, sin el ruido de la coma flotante (0.1 + 0.2 es 0.3)", () => {
    expect(0.1 + 0.2 === 0.3).toBe(false); // lo que NO se puede hacer con dinero
    expect(mismosCentavos(0.1 + 0.2, 0.3)).toBe(true);
    expect(mismosCentavos(1070.11, 1000.1 * 1.07)).toBe(true);
    expect(centavosDeImporte(0.1 + 0.2)).toBe(30);
    expect(centavosDeImporte(16762.5)).toBe(1676250);
  });

  it("un centavo de diferencia ya es otro precio", () => {
    expect(mismosCentavos(13000, 13000.01)).toBe(false);
    expect(mismosCentavos(0.01, 0)).toBe(false);
    expect(mismosCentavos(999999999999.99, 999999999999.98)).toBe(false);
    expect(mismosCentavos(999999999999.99, 999999999999.99)).toBe(true);
  });

  it("el número que viene de un Decimal(14,2) y el tecleado son el mismo dinero", () => {
    expect(mismosCentavos(Number("3500.50"), 3500.5)).toBe(true);
    expect(mismosCentavos(Number("14900.00"), 14900)).toBe(true);
    expect(mismosCentavos(-0, 0)).toBe(true);
  });

  it("null es «sin importe»: solo igual a otro null", () => {
    expect(mismosCentavos(null, null)).toBe(true);
    expect(mismosCentavos(null, 0)).toBe(false);
    expect(mismosCentavos(0, null)).toBe(false);
  });

  it("un valor no finito no es igual a nada (ni a sí mismo)", () => {
    expect(mismosCentavos(Number.NaN, Number.NaN)).toBe(false);
    expect(mismosCentavos(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY)).toBe(false);
    expect(mismosCentavos(Number.NaN, 0)).toBe(false);
  });
});
