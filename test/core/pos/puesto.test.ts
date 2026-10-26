import { describe, expect, it } from "vitest";
import { esMostrador, frasesDePuesto, rotuloDePuesto } from "@/core/pos/puesto";

/** El puesto del salón (ADR-039): para una mesa cada texto es el de siempre, byte a byte; el mostrador (número 0) se nombra aparte. */
describe("puesto del salón: rótulo y frases", () => {
  it("el mostrador es el número 0 y solo él", () => {
    expect(esMostrador(0)).toBe(true);
    for (const n of [1, 2, 7, 10, 9999, -1]) expect(esMostrador(n)).toBe(false);
  });

  it("rótulo: «Mesa 07» con el mismo formato de número que la tarjeta del mapa, y «Mostrador»", () => {
    expect(rotuloDePuesto(4)).toBe("Mesa 04");
    expect(rotuloDePuesto(7)).toBe("Mesa 07");
    expect(rotuloDePuesto(12)).toBe("Mesa 12");
    expect(rotuloDePuesto(1234)).toBe("Mesa 1234");
    expect(rotuloDePuesto(0)).toBe("Mostrador");
  });

  it("frases de una mesa: las de siempre, sin cero a la izquierda", () => {
    expect(frasesDePuesto(7)).toEqual({ detalle: "Mesa 7", el: "la mesa 7", El: "La mesa 7", del: "de la mesa 7", al: "a la mesa 7" });
    expect(frasesDePuesto(12).detalle).toBe("Mesa 12");
  });

  it("frases del mostrador", () => {
    expect(frasesDePuesto(0)).toEqual({ detalle: "Mostrador", el: "el mostrador", El: "El mostrador", del: "del mostrador", al: "al mostrador" });
  });
});
