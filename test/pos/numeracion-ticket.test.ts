import { describe, expect, it } from "vitest";
import { formatearNumeroTicket, letraDeEjemplar, siguienteNumeroTicket } from "../../src/core/pos/numeracion-ticket";

/**
 * Numeración del ticket de cierre (src/core/pos/numeracion-ticket.ts, docs/plan-numeracion-ticket-2026-09-25.md): núcleo puro.
 * Número BASE secuencial por sucursal (max + 1) y ejemplar entero (1 = A, 2 = B…), que se muestra como letra: «566-A», «566-B».
 */
describe("siguienteNumeroTicket", () => {
  it("sin ningún ticket en la sucursal arranca en 1", () => {
    expect(siguienteNumeroTicket(null)).toBe(1);
  });

  it("con tickets, es el máximo + 1", () => {
    expect(siguienteNumeroTicket(1)).toBe(2);
    expect(siguienteNumeroTicket(565)).toBe(566);
  });
});

describe("letraDeEjemplar", () => {
  it("1 → A, 2 → B, 26 → Z", () => {
    expect(letraDeEjemplar(1)).toBe("A");
    expect(letraDeEjemplar(2)).toBe("B");
    expect(letraDeEjemplar(26)).toBe("Z");
  });

  it("después de la Z sigue como las columnas de una planilla: 27 → AA, 28 → AB, 52 → AZ, 53 → BA, 702 → ZZ, 703 → AAA", () => {
    expect([27, 28, 52, 53, 702, 703].map(letraDeEjemplar)).toEqual(["AA", "AB", "AZ", "BA", "ZZ", "AAA"]);
  });

  it("rechaza un ejemplar menor que 1 o no entero", () => {
    for (const malo of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => letraDeEjemplar(malo), String(malo)).toThrow();
  });
});

describe("formatearNumeroTicket", () => {
  it("número y letra del ejemplar, sin ceros a la izquierda", () => {
    expect(formatearNumeroTicket({ numero: 566, ejemplar: 1 })).toBe("566-A");
    expect(formatearNumeroTicket({ numero: 566, ejemplar: 2 })).toBe("566-B");
    expect(formatearNumeroTicket({ numero: 7, ejemplar: 27 })).toBe("7-AA");
  });
});
