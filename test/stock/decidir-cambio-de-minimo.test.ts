import { describe, expect, it } from "vitest";
import { decidirCambioDeMinimo, mismoMinimo } from "../../src/core/stock/stock-minimo";

/** I8 del diseño del módulo Stock: la decisión pura de «Cambiar mínimo» con el valor visto. */
describe("decidirCambioDeMinimo", () => {
  it("sigue como se vio → CAMBIAR", () => {
    expect(decidirCambioDeMinimo({ actual: 10, visto: 10, nuevo: 12 })).toBe("CAMBIAR");
  });

  it("ya tiene el valor pedido → SIN_CAMBIO, aunque no sea el que se vio (doble clic, o dos personas que pidieron lo mismo)", () => {
    expect(decidirCambioDeMinimo({ actual: 12, visto: 10, nuevo: 12 })).toBe("SIN_CAMBIO");
    expect(decidirCambioDeMinimo({ actual: 0, visto: 0, nuevo: 0 })).toBe("SIN_CAMBIO");
  });

  it("otra persona lo cambió o lo borró → CAMBIO_AJENO", () => {
    expect(decidirCambioDeMinimo({ actual: 7, visto: 10, nuevo: 12 })).toBe("CAMBIO_AJENO");
    expect(decidirCambioDeMinimo({ actual: null, visto: 10, nuevo: 12 })).toBe("CAMBIO_AJENO");
  });

  it("compara a la escala de la base (4 decimales): 1,23456 guardado como 1,2346 es el mismo mínimo", () => {
    expect(mismoMinimo(1.2346, 1.23456)).toBe(true);
    expect(mismoMinimo(1.2346, 1.2347)).toBe(false);
    expect(decidirCambioDeMinimo({ actual: 1.2346, visto: 1, nuevo: 1.23456 })).toBe("SIN_CAMBIO");
  });
});
