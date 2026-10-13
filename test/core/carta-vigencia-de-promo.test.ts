import { describe, expect, it } from "vitest";
import { mascaraDeDias, promoVigenteEl, TODOS_LOS_DIAS, validarVigenciaDePromo, type VigenciaDePromo } from "../../src/core/carta/vigencia-de-promo";
import { diaDeCalendario, diaDeLaSemana, ZONA_ARGENTINA } from "../../src/core/tiempo/zona-horaria";

/**
 * GO-3 (ADR-032, D-7), paso D1: la vigencia de una promo por fechas (rango INCLUSIVE) y por días de la semana (máscara, bit 0 = lunes … bit 6 = domingo), con «hoy» como el día de calendario de
 * la zona de la empresa. Bordes: el domingo (bit 6), las dos puntas del rango, la medianoche argentina (23:30 del 13/10 en ART es el 14/10 en UTC) y lo inválido, que falla cerrado.
 * Mutaciones demostradas: comparar con `<` en vez de `<=` en «hasta» (cae «rango inclusive») y numerar los días desde el domingo (cae «el domingo es el bit 6»).
 */
const sinLimite: VigenciaDePromo = { vigenteDesde: null, vigenteHasta: null, diasDeSemana: null };
const LUN_A_VIE = mascaraDeDias([0, 1, 2, 3, 4]);

describe("el día de la semana de un día de calendario (core/tiempo)", () => {
  it("0 = lunes … 6 = domingo, con fechas conocidas (también un 29 de febrero)", () => {
    expect(diaDeLaSemana("2026-10-13")).toBe(1); // martes
    expect(diaDeLaSemana("2026-10-18")).toBe(6); // domingo
    expect(diaDeLaSemana("2026-10-19")).toBe(0); // lunes
    expect(diaDeLaSemana("2024-02-29")).toBe(3); // jueves
    expect(() => diaDeLaSemana("2026-10-1")).toThrow(RangeError);
  });
});

describe("la máscara de días", () => {
  it("lunes a viernes es 31, todos los días 127, el domingo solo es 64; un día fuera de 0 a 6 es un error", () => {
    expect(LUN_A_VIE).toBe(31);
    expect(mascaraDeDias([0, 1, 2, 3, 4, 5, 6])).toBe(TODOS_LOS_DIAS);
    expect(mascaraDeDias([6, 6])).toBe(64);
    expect(() => mascaraDeDias([7])).toThrow(RangeError);
  });
});

describe("promoVigenteEl", () => {
  it("sin límites vale siempre", () => {
    for (const dia of ["2026-10-13", "2026-10-18", "2030-01-01"]) expect(promoVigenteEl(sinLimite, dia), dia).toBe(true);
  });

  it("de lunes a viernes: el viernes sí, el sábado y el domingo no, el lunes sí", () => {
    const v = { ...sinLimite, diasDeSemana: LUN_A_VIE };
    expect(["2026-10-16", "2026-10-17", "2026-10-18", "2026-10-19"].map((d) => promoVigenteEl(v, d))).toEqual([true, false, false, true]);
    expect(promoVigenteEl({ ...sinLimite, diasDeSemana: 64 }, "2026-10-18"), "solo los domingos: el domingo vale").toBe(true);
    expect(promoVigenteEl({ ...sinLimite, diasDeSemana: 64 }, "2026-10-19")).toBe(false);
  });

  it("el rango es INCLUSIVE en las dos puntas; con una sola punta, abierto del otro lado", () => {
    const v = { ...sinLimite, vigenteDesde: "2026-10-01", vigenteHasta: "2026-10-31" };
    expect(["2026-09-30", "2026-10-01", "2026-10-31", "2026-11-01"].map((d) => promoVigenteEl(v, d))).toEqual([false, true, true, false]);
    expect(promoVigenteEl({ ...sinLimite, vigenteDesde: "2026-10-14" }, "2027-05-01")).toBe(true);
    expect(promoVigenteEl({ ...sinLimite, vigenteHasta: "2026-10-14" }, "2026-10-15")).toBe(false);
    expect(promoVigenteEl({ ...sinLimite, vigenteDesde: "2026-10-14", vigenteHasta: "2026-10-14" }, "2026-10-14"), "un solo día").toBe(true);
  });

  it("«hoy» es el día de la zona de la empresa: a las 23:30 del 13/10 en Argentina (02:30 UTC del 14/10) todavía vale una promo que termina el 13", () => {
    const instante = new Date("2026-10-14T02:30:00Z");
    const hoy = diaDeCalendario(instante, ZONA_ARGENTINA);
    expect(hoy).toBe("2026-10-13");
    expect(promoVigenteEl({ ...sinLimite, vigenteHasta: "2026-10-13" }, hoy)).toBe(true);
    expect(promoVigenteEl({ ...sinLimite, vigenteHasta: "2026-10-13" }, instante.toISOString().slice(0, 10)), "con el día UTC sería el 14: no").toBe(false);
  });

  it("lo inválido falla cerrado (no vale): el día, el rango invertido o la máscara fuera de 1 a 127", () => {
    expect(promoVigenteEl(sinLimite, "2026-02-30")).toBe(false);
    expect(promoVigenteEl({ ...sinLimite, vigenteDesde: "2026-10-31", vigenteHasta: "2026-10-01" }, "2026-10-15")).toBe(false);
    for (const m of [0, 128, 1.5]) expect(promoVigenteEl({ ...sinLimite, diasDeSemana: m }, "2026-10-13"), `máscara ${m}`).toBe(false);
  });
});

describe("validarVigenciaDePromo (al guardar)", () => {
  it("acepta lo válido y rechaza con VIGENCIA_INVALIDA las fechas que no existen, el rango invertido y la máscara vacía o fuera de rango", () => {
    expect(validarVigenciaDePromo({ vigenteDesde: "2026-10-01", vigenteHasta: "2026-10-31", diasDeSemana: LUN_A_VIE })).toEqual({ ok: true });
    expect(validarVigenciaDePromo(sinLimite)).toEqual({ ok: true });
    for (const v of [
      { ...sinLimite, vigenteDesde: "2026-13-01" },
      { ...sinLimite, vigenteHasta: "ayer" },
      { ...sinLimite, vigenteDesde: "2026-10-02", vigenteHasta: "2026-10-01" },
      { ...sinLimite, diasDeSemana: 0 },
      { ...sinLimite, diasDeSemana: 128 },
    ]) {
      expect(validarVigenciaDePromo(v), JSON.stringify(v)).toMatchObject({ ok: false, codigo: "VIGENCIA_INVALIDA" });
    }
  });
});
