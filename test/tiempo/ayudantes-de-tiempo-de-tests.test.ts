import { describe, expect, it } from "vitest";
import { AHORA_DE_LA_CORRIDA, DIA_MS, HORA_MS, MINUTO_MS, enElFuturo, enElPasado } from "../setup/tiempo";

/** Los ayudantes de tiempo para tests con base (ver `test/setup/tiempo.ts` y `test/arquitectura/fechas-fijas-en-tests-con-base.test.ts`). */
describe("ayudantes de tiempo de los tests", () => {
  it("las constantes son las que dicen ser", () => {
    expect(MINUTO_MS).toBe(60_000);
    expect(HORA_MS).toBe(60 * MINUTO_MS);
    expect(DIA_MS).toBe(24 * HORA_MS);
  });

  it("enElFuturo y enElPasado parten del reloj REAL, no de una fecha fija", () => {
    const antes = Date.now();
    const futuro = enElFuturo(HORA_MS).getTime();
    const pasado = enElPasado(HORA_MS).getTime();
    const despues = Date.now();
    expect(futuro).toBeGreaterThanOrEqual(antes + HORA_MS);
    expect(futuro).toBeLessThanOrEqual(despues + HORA_MS);
    expect(pasado).toBeGreaterThanOrEqual(antes - HORA_MS);
    expect(pasado).toBeLessThanOrEqual(despues - HORA_MS);
  });

  it("el «ahora» de la corrida es el reloj real (redondeado al segundo) y no cambia durante el proceso", () => {
    expect(AHORA_DE_LA_CORRIDA.getTime() % 1000).toBe(0);
    expect(Math.abs(Date.now() - AHORA_DE_LA_CORRIDA.getTime())).toBeLessThan(10 * 60_000);
    expect(AHORA_DE_LA_CORRIDA).toBe(AHORA_DE_LA_CORRIDA);
  });
});
