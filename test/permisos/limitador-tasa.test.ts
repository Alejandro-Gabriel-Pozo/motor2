import { describe, expect, it } from "vitest";
import { crearLimitadorDeTasa, MAXIMO_DE_CLAVES_DEL_LIMITADOR } from "../../src/core/permisos/limitador-tasa";

/** La hora entra por parámetro (Pureza 1.3): sin relojes falsos, cada caso fija el instante en milisegundos. */
const T0 = 1_800_000_000_000;

describe("crearLimitadorDeTasa: no recuerda claves sin límite (M-17 de la auditoría intermedia)", () => {
  it("el ataque: un anónimo con claves siempre nuevas no hace crecer el mapa más allá del tope (antes crecía sin límite)", () => {
    const limitador = crearLimitadorDeTasa(10, 60_000);
    for (let i = 0; i < MAXIMO_DE_CLAVES_DEL_LIMITADOR * 4; i++) limitador.excedeLimite(`ip-${i}`, T0);
    expect(limitador.clavesRecordadas()).toBeLessThanOrEqual(MAXIMO_DE_CLAVES_DEL_LIMITADOR);
  });

  it("las claves vencidas se liberan al crecer: tras pasar la ventana, lo viejo no cuenta para el tope", () => {
    const limitador = crearLimitadorDeTasa(10, 60_000, 100);
    for (let i = 0; i < 100; i++) limitador.excedeLimite(`vieja-${i}`, T0);
    expect(limitador.clavesRecordadas()).toBe(100);
    // 61 s después llega una clave nueva por encima del tope: se barre lo vencido y queda solo la nueva
    limitador.excedeLimite("nueva-1", T0 + 61_000);
    limitador.excedeLimite("nueva-2", T0 + 61_000);
    expect(limitador.clavesRecordadas()).toBeLessThanOrEqual(100);
    for (let i = 0; i < 100; i++) limitador.excedeLimite(`n-${i}`, T0 + 61_000);
    expect(limitador.clavesRecordadas()).toBeLessThanOrEqual(100);
  });

  it("una clave activa sigue contando mientras no se pase del tope; olvidar la más vieja (al pasarse) solo reinicia SU conteo", () => {
    const limitador = crearLimitadorDeTasa(2, 60_000, 3);
    expect(limitador.excedeLimite("a", T0)).toBe(false);
    expect(limitador.excedeLimite("a", T0)).toBe(false);
    expect(limitador.excedeLimite("a", T0)).toBe(true); // a ya excedió
    limitador.excedeLimite("b", T0);
    limitador.excedeLimite("c", T0);
    expect(limitador.excedeLimite("a", T0)).toBe(true); // 3 claves: entra en el tope, sigue contando
    limitador.excedeLimite("d", T0); // 4 claves > tope 3: se olvida la más vieja ("a")
    expect(limitador.clavesRecordadas()).toBeLessThanOrEqual(3);
    expect(limitador.excedeLimite("a", T0)).toBe(false); // su conteo empezó de cero (best effort)
  });
});

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

  // M-19: `yaExcedida` solo MIRA (no cuenta): sirve para cortar antes de gastar base sin gastar el cupo dos veces.
  it("yaExcedida: falso hasta que el conteo pasa el límite, no cuenta por sí sola y vuelve a falso con la ventana nueva", () => {
    const limitador = crearLimitadorDeTasa(2, 60_000);
    expect(limitador.yaExcedida("u", T0)).toBe(false); // sin ventana
    limitador.excedeLimite("u", T0); // 1
    limitador.excedeLimite("u", T0); // 2: en el límite, todavía no pasada
    expect(limitador.yaExcedida("u", T0)).toBe(false);
    expect(limitador.excedeLimite("u", T0)).toBe(true); // 3: la que se pasa
    for (let i = 0; i < 10; i++) expect(limitador.yaExcedida("u", T0)).toBe(true); // mirar no suma: sigue igual
    expect(limitador.yaExcedida("otro", T0)).toBe(false); // por clave
    expect(limitador.yaExcedida("u", T0 + 60_001)).toBe(false); // ventana vencida
    expect(limitador.excedeLimite("u", T0 + 60_001)).toBe(false); // y vuelve a contar desde 1
  });

  it("se resetea sola al pasar la ventana (y no antes)", () => {
    const limitador = crearLimitadorDeTasa(1, 60_000);
    expect(limitador.excedeLimite("usuario-1", T0)).toBe(false);
    expect(limitador.excedeLimite("usuario-1", T0 + 59_999)).toBe(true); // todavía dentro de la ventana
    expect(limitador.excedeLimite("usuario-1", T0 + 60_001)).toBe(false); // ventana nueva
  });
});
