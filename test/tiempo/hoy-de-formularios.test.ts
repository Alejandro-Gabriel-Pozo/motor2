import { afterEach, describe, expect, it, vi } from "vitest";
import { ZONA_ARGENTINA, diaDeCalendario } from "../../src/core/tiempo/zona-horaria";

/**
 * El «hoy» que proponen los formularios es `diaDeCalendario(new Date(), ZONA_ARGENTINA)`, no `new Date().toISOString().slice(0, 10)` (que es el día en UTC). Argentina es UTC-3 todo el año
 * (sin horario de verano): desde las 21:00 locales UTC ya está en el día siguiente, y los formularios proponían «mañana».
 */
describe("«hoy» de un formulario en hora argentina", () => {
  afterEach(() => vi.useRealTimers());

  const hoy = (instante: string) => diaDeCalendario(new Date(instante), ZONA_ARGENTINA);

  it("a las 21:00, 22:30 y 23:59 argentinas sigue siendo el mismo día (UTC ya es el siguiente)", () => {
    expect(hoy("2026-09-30T21:00:00-03:00")).toBe("2026-09-30");
    expect(hoy("2026-09-30T22:30:00-03:00")).toBe("2026-09-30");
    expect(hoy("2026-09-30T23:59:59.999-03:00")).toBe("2026-09-30");
  });

  it("a las 00:00 argentinas empieza el día siguiente", () => {
    expect(hoy("2026-10-01T00:00:00-03:00")).toBe("2026-10-01");
  });

  it("a las 20:59 argentinas (23:59 UTC) UTC y Argentina coinciden", () => {
    expect(hoy("2026-09-30T20:59:59-03:00")).toBe("2026-09-30");
  });

  it("cruza el cambio de mes y el de año sin saltarse el día local", () => {
    expect(hoy("2026-02-28T22:00:00-03:00")).toBe("2026-02-28"); // UTC ya es 1/3
    expect(hoy("2028-02-29T22:00:00-03:00")).toBe("2028-02-29"); // año bisiesto
    expect(hoy("2026-12-31T23:30:00-03:00")).toBe("2026-12-31"); // UTC ya es 1/1/2027
    expect(hoy("2027-01-01T00:00:00-03:00")).toBe("2027-01-01");
  });

  it("con el reloj en las 22:00 argentinas propone hoy, no mañana (lo que hacían los 5 formularios con UTC)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-30T22:00:00-03:00"));
    expect(new Date().toISOString().slice(0, 10)).toBe("2026-10-01"); // el cálculo viejo: mañana
    expect(diaDeCalendario(new Date(), ZONA_ARGENTINA)).toBe("2026-09-30");
  });
});
