import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { crearLimitadorDeTasa } from "../../src/core/permisos/limitador-tasa";

describe("crearLimitadorDeTasa", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("permite hasta el límite, y corta la siguiente", () => {
    const limitador = crearLimitadorDeTasa(3, 60_000);
    expect(limitador.excedeLimite("usuario-1")).toBe(false); // 1
    expect(limitador.excedeLimite("usuario-1")).toBe(false); // 2
    expect(limitador.excedeLimite("usuario-1")).toBe(false); // 3
    expect(limitador.excedeLimite("usuario-1")).toBe(true); // 4 — excede
  });

  it("cuenta cada clave (usuarioId) por separado", () => {
    const limitador = crearLimitadorDeTasa(1, 60_000);
    expect(limitador.excedeLimite("usuario-1")).toBe(false);
    expect(limitador.excedeLimite("usuario-2")).toBe(false); // no se contagia del conteo de usuario-1
    expect(limitador.excedeLimite("usuario-1")).toBe(true);
  });

  it("se resetea sola al pasar la ventana", () => {
    const limitador = crearLimitadorDeTasa(1, 60_000);
    expect(limitador.excedeLimite("usuario-1")).toBe(false);
    expect(limitador.excedeLimite("usuario-1")).toBe(true);

    vi.advanceTimersByTime(60_001);
    expect(limitador.excedeLimite("usuario-1")).toBe(false); // ventana nueva
  });
});
