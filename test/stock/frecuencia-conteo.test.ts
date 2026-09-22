import { describe, expect, it } from "vitest";
import { resolverProximoConteo } from "@/core/stock/frecuencia-conteo";

describe("resolverProximoConteo", () => {
  it("sin agenda (frecuenciaDias 0) nunca está vencido, aunque nunca se haya contado", () => {
    expect(resolverProximoConteo({ ultimaFechaConteo: null, frecuenciaDias: 0, hoy: new Date("2026-09-22") })).toEqual({
      proximaFecha: null,
      diasDeAtraso: null,
      vencido: false,
    });
  });

  it("sin agenda (frecuenciaDias 0) nunca está vencido, ni siquiera con un conteo muy viejo", () => {
    expect(resolverProximoConteo({ ultimaFechaConteo: new Date("2020-01-01"), frecuenciaDias: 0, hoy: new Date("2026-09-22") })).toEqual({
      proximaFecha: null,
      diasDeAtraso: null,
      vencido: false,
    });
  });

  it("con agenda pero sin conteo previo: vencido, sin fecha/atraso numérico (no hay ancla)", () => {
    expect(resolverProximoConteo({ ultimaFechaConteo: null, frecuenciaDias: 7, hoy: new Date("2026-09-22") })).toEqual({
      proximaFecha: null,
      diasDeAtraso: null,
      vencido: true,
    });
  });

  it("con agenda y conteo reciente: no vencido, próxima fecha = último conteo + frecuencia", () => {
    const resultado = resolverProximoConteo({ ultimaFechaConteo: new Date("2026-09-20T00:00:00Z"), frecuenciaDias: 7, hoy: new Date("2026-09-22T00:00:00Z") });
    expect(resultado.vencido).toBe(false);
    expect(resultado.diasDeAtraso).toBe(0);
    expect(resultado.proximaFecha?.toISOString().slice(0, 10)).toBe("2026-09-27");
  });

  it("justo el día de la próxima fecha: todavía no vencido (vence cuando hoy la PASA, no cuando la iguala)", () => {
    const resultado = resolverProximoConteo({ ultimaFechaConteo: new Date("2026-09-15T00:00:00Z"), frecuenciaDias: 7, hoy: new Date("2026-09-22T00:00:00Z") });
    expect(resultado.proximaFecha?.toISOString().slice(0, 10)).toBe("2026-09-22");
    expect(resultado.vencido).toBe(false);
    expect(resultado.diasDeAtraso).toBe(0);
  });

  it("con agenda y conteo vencido: diasDeAtraso cuenta días completos", () => {
    const resultado = resolverProximoConteo({ ultimaFechaConteo: new Date("2026-09-01T00:00:00Z"), frecuenciaDias: 7, hoy: new Date("2026-09-22T00:00:00Z") });
    // próxima fecha 2026-09-08, hoy 2026-09-22 → 14 días de atraso
    expect(resultado.proximaFecha?.toISOString().slice(0, 10)).toBe("2026-09-08");
    expect(resultado.vencido).toBe(true);
    expect(resultado.diasDeAtraso).toBe(14);
  });
});
