import { describe, expect, it } from "vitest";
import { validarFechaOperacion } from "../../src/core/datos/fecha-operacion";

// 2026-10-01 12:00 en Argentina (UTC-3) = 15:00 UTC.
const AHORA = new Date("2026-10-01T15:00:00Z");
const DIA = 24 * 60 * 60 * 1000;

describe("validarFechaOperacion", () => {
  it("acepta ahora, ayer y la fecha de hoy tecleada como medianoche UTC", () => {
    expect(validarFechaOperacion(AHORA, AHORA)).toEqual({ ok: true, valor: AHORA });
    expect(validarFechaOperacion(new Date(AHORA.getTime() - DIA), AHORA).ok).toBe(true);
    expect(validarFechaOperacion(new Date("2026-10-01"), AHORA).ok).toBe(true);
  });

  it.each([undefined, null, "2026-10-01", 1759330800000, {}, new Date("no es una fecha")])("rechaza %j como fecha inválida, no como error crudo", (valor) => {
    expect(validarFechaOperacion(valor, AHORA)).toEqual({ ok: false, codigo: "formato", mensaje: "La fecha no es válida." });
  });

  it("el límite futuro es el fin de mañana en hora de Argentina", () => {
    // Mañana 23:59 AR = 2026-10-03T02:59Z: pasa. Pasado mañana 00:00 AR = 2026-10-03T03:00Z: no.
    expect(validarFechaOperacion(new Date("2026-10-03T02:59:59Z"), AHORA).ok).toBe(true);
    expect(validarFechaOperacion(new Date("2026-10-03T03:00:00Z"), AHORA)).toMatchObject({ ok: false, codigo: "rango", mensaje: "La fecha no puede ser posterior a mañana." });
    expect(validarFechaOperacion(new Date("2099-01-01"), AHORA).ok).toBe(false);
  });

  it("de madrugada en UTC pero todavía de noche en Argentina, 'hoy' sigue siendo el día argentino", () => {
    const ahora = new Date("2026-10-02T01:00:00Z"); // 22:00 del 1/10 en Argentina
    expect(validarFechaOperacion(new Date("2026-10-03T02:59:59Z"), ahora).ok).toBe(true);
    expect(validarFechaOperacion(new Date("2026-10-03T03:00:00Z"), ahora).ok).toBe(false);
  });

  it("con otra zona, el límite futuro es el fin de mañana de ESA zona (Nueva York, UTC-4 en octubre)", () => {
    // Mañana 23:59 en Nueva York = 2026-10-03T03:59Z: pasa. Pasado mañana 00:00 = 2026-10-03T04:00Z: no.
    expect(validarFechaOperacion(new Date("2026-10-03T03:59:59Z"), AHORA, "America/New_York").ok).toBe(true);
    expect(validarFechaOperacion(new Date("2026-10-03T04:00:00Z"), AHORA, "America/New_York").ok).toBe(false);
  });

  it("el piso es de 400 días", () => {
    expect(validarFechaOperacion(new Date(AHORA.getTime() - 400 * DIA), AHORA).ok).toBe(true);
    expect(validarFechaOperacion(new Date(AHORA.getTime() - 400 * DIA - 1), AHORA)).toMatchObject({ ok: false, codigo: "rango" });
    expect(validarFechaOperacion(new Date("1970-01-01"), AHORA).ok).toBe(false);
  });
});
