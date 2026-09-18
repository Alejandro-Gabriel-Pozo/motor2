import { describe, expect, it } from "vitest";
import { esNumeroFinito } from "@/core/numero";

// Sin base de datos: `esNumeroFinito` es pura.
describe("esNumeroFinito — el hueco que dejan `!(x > 0)` y `< 0`", () => {
  it("Infinity pasa `> 0` pero no es finito", () => {
    expect(Infinity > 0).toBe(true);
    expect(esNumeroFinito(Infinity)).toBe(false);
    expect(esNumeroFinito(-Infinity)).toBe(false);
  });

  it("NaN pasa `< 0` (NaN < 0 es false) pero no es finito", () => {
    expect(Number.NaN < 0).toBe(false);
    expect(esNumeroFinito(Number.NaN)).toBe(false);
  });

  it("acepta números normales, incluidos 0 y negativos", () => {
    expect(esNumeroFinito(0)).toBe(true);
    expect(esNumeroFinito(-5)).toBe(true);
    expect(esNumeroFinito(12.5)).toBe(true);
  });

  it("convierte con Number(): un número que llega como texto sigue siendo válido, como en las comparaciones existentes", () => {
    expect(esNumeroFinito("5")).toBe(true);
    expect(esNumeroFinito("abc")).toBe(false);
    expect(esNumeroFinito("Infinity")).toBe(false);
    expect(esNumeroFinito(undefined)).toBe(false);
  });

  it("null, '' y [] convierten a 0 con Number(): cuentan como finitos (asimetría con undefined, a propósito)", () => {
    expect(esNumeroFinito(null)).toBe(true);
    expect(esNumeroFinito("")).toBe(true);
    expect(esNumeroFinito([])).toBe(true);
  });
});
