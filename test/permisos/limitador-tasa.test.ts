import { describe, expect, it } from "vitest";
import { crearLimitadorDeTasa } from "../../src/core/permisos/limitador-tasa";

/** La hora entra por parámetro (Pureza 1.3): sin relojes falsos, cada caso fija el instante en milisegundos. */
const T0 = 1_800_000_000_000;

describe("crearLimitadorDeTasa", () => {
  it("permite hasta el límite, y corta la siguiente", () => {
    const limitador = crearLimitadorDeTasa(3, 60_000);
    expect(limitador.excedeLimite("usuario-1", T0)).toBe(false); // 1
    expect(limitador.excedeLimite("usuario-1", T0)).toBe(false); // 2
    expect(limitador.excedeLimite("usuario-1", T0)).toBe(false); // 3
    expect(limitador.excedeLimite("usuario-1", T0)).toBe(true); // 4 — excede
  });

  it("cuenta cada clave (usuarioId) por separado", () => {
    const limitador = crearLimitadorDeTasa(1, 60_000);
    expect(limitador.excedeLimite("usuario-1", T0)).toBe(false);
    expect(limitador.excedeLimite("usuario-2", T0)).toBe(false); // no se contagia del conteo de usuario-1
    expect(limitador.excedeLimite("usuario-1", T0)).toBe(true);
  });

  it("se resetea sola al pasar la ventana (y no antes)", () => {
    const limitador = crearLimitadorDeTasa(1, 60_000);
    expect(limitador.excedeLimite("usuario-1", T0)).toBe(false);
    expect(limitador.excedeLimite("usuario-1", T0 + 59_999)).toBe(true); // todavía dentro de la ventana
    expect(limitador.excedeLimite("usuario-1", T0 + 60_001)).toBe(false); // ventana nueva
  });
});
