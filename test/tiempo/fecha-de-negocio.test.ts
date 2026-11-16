import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { HORA_DE_CORTE_POR_DEFECTO, INSTANTE_MAXIMO, INSTANTE_MINIMO, fechaDeNegocio } from "@/core/tiempo/fecha-de-negocio";
import { ZONA_ARGENTINA, diaDeCalendario } from "@/core/tiempo/zona-horaria";

/**
 * Oráculo de `fechaDeNegocio` (frente 3, hora de corte): casos fijos escritos a mano (Argentina UTC−3 sin horario de verano; Nueva York con horario de verano; Calcuta +5:30; fechas límite),
 * el orden de los errores y propiedades contra un cálculo independiente (el día civil de `diaDeCalendario` del instante corrido por el corte, en una zona sin horario de verano).
 */
const AR = ZONA_ARGENTINA;
const en = (iso: string, zona: string, corte: string) => fechaDeNegocio(new Date(iso), zona, corte);

describe("fechaDeNegocio: casos fijos", () => {
  it.each([
    // Argentina UTC−3. Corte 04:00: de las 00:00 a las 03:59 locales rige la jornada anterior.
    ["2026-11-16T06:59:00Z", AR, "04:00", "2026-11-15"],
    ["2026-11-16T07:00:00Z", AR, "04:00", "2026-11-16"],
    ["2026-11-16T06:59:59.999Z", AR, "04:00", "2026-11-15"],
    ["2026-11-16T02:59:00Z", AR, "00:00", "2026-11-15"],
    ["2026-11-16T03:00:00Z", AR, "00:00", "2026-11-16"],
    ["2026-11-16T14:00:00Z", AR, "04:00", "2026-11-16"],
    ["2026-11-17T02:59:00Z", AR, "23:59", "2026-11-16"],
    ["2026-11-17T03:00:00Z", AR, "23:59", "2026-11-16"],
    ["2026-11-17T03:00:00Z", AR, "00:01", "2026-11-16"],
    // Cambio de mes y de año hacia atrás.
    ["2026-12-01T05:00:00Z", AR, "04:00", "2026-11-30"],
    ["2027-01-01T05:00:00Z", AR, "04:00", "2026-12-31"],
    ["2028-03-01T05:00:00Z", AR, "04:00", "2028-02-29"],
    // Otras zonas: la jornada es la de SU zona, no la de UTC.
    ["2026-11-15T22:29:00Z", "Asia/Kolkata", "04:00", "2026-11-15"],
    ["2026-11-15T22:30:00Z", "Asia/Kolkata", "04:00", "2026-11-16"],
    ["2026-11-16T04:00:00Z", "UTC", "04:00", "2026-11-16"],
    ["2026-11-16T03:59:00Z", "UTC", "04:00", "2026-11-15"],
    // Horario de verano: Nueva York, cambio del 2026-03-08 (a las 02:00 locales se pasa a las 03:00).
    ["2026-03-08T06:59:00Z", "America/New_York", "04:00", "2026-03-07"],
    ["2026-03-08T07:59:00Z", "America/New_York", "04:00", "2026-03-07"],
    ["2026-03-08T08:00:00Z", "America/New_York", "04:00", "2026-03-08"],
  ] as const)("%s en %s con corte %s → %s", (instante, zona, corte, esperado) => {
    expect(en(instante, zona, corte)).toEqual({ ok: true, valor: esperado });
  });

  it("los segundos no cuentan: la jornada cambia exactamente en punto", () => {
    expect(en("2026-11-16T06:59:59.999Z", AR, "04:00")).toMatchObject({ valor: "2026-11-15" });
    expect(en("2026-11-16T07:00:00.000Z", AR, "04:00")).toMatchObject({ valor: "2026-11-16" });
  });

  it("los años 0001 y 9999 se calculan sin correrse a 1900 o 1999", () => {
    expect(en("0001-01-05T12:00:00Z", "UTC", "00:00")).toEqual({ ok: true, valor: "0001-01-05" });
    expect(en("9999-12-29T12:00:00Z", "UTC", "00:00")).toEqual({ ok: true, valor: "9999-12-29" });
  });

  it("el corte por defecto es 00:00: la jornada es el día civil", () => {
    expect(HORA_DE_CORTE_POR_DEFECTO).toBe("00:00");
  });
});

describe("fechaDeNegocio: errores cerrados y su orden", () => {
  it.each(["", "4:00", "24:00", "04:60", "04:00:00", " 04:00", "04-00", "0400", "ab:cd", "04:0", "+4:00"])("la hora de corte «%s» se rechaza", (corte) => {
    expect(en("2026-11-16T12:00:00Z", AR, corte)).toEqual({ ok: false, error: "HORA_DE_CORTE_INVALIDA" });
  });

  it.each(["", "EST", "america/argentina/buenos_aires", "America/Nada/Nada", "+03:00", "-03:00", "Buenos_Aires", " UTC"])("la zona «%s» se rechaza", (zona) => {
    expect(en("2026-11-16T12:00:00Z", zona, "00:00")).toEqual({ ok: false, error: "ZONA_HORARIA_INVALIDA" });
  });

  it.each([[Number.NaN], [INSTANTE_MINIMO - 1], [INSTANTE_MAXIMO + 1], [Number.POSITIVE_INFINITY]])("el instante %s se rechaza", (ms) => {
    expect(fechaDeNegocio(new Date(ms), AR, "00:00")).toEqual({ ok: false, error: "INSTANTE_INVALIDO" });
  });

  it("el primer error gana: corte, después zona, después instante", () => {
    const malo = new Date(Number.NaN);
    expect(fechaDeNegocio(malo, "EST", "24:00")).toEqual({ ok: false, error: "HORA_DE_CORTE_INVALIDA" });
    expect(fechaDeNegocio(malo, "EST", "00:00")).toEqual({ ok: false, error: "ZONA_HORARIA_INVALIDA" });
    expect(fechaDeNegocio(malo, AR, "00:00")).toEqual({ ok: false, error: "INSTANTE_INVALIDO" });
  });

  it.each([[null], [undefined], ["2026-11-16T12:00:00Z"], [1_763_300_000_000], [{}], [{ getTime: () => 1_763_300_000_000 }], [[]], [true]])("un instante que no es un Date (%s) devuelve INSTANTE_INVALIDO y no lanza", (malo) => {
    expect(fechaDeNegocio(malo as unknown as Date, AR, "00:00")).toEqual({ ok: false, error: "INSTANTE_INVALIDO" });
  });

  it("un Date de otro contexto (otro realm) sí vale", async () => {
    const { runInNewContext } = await import("node:vm");
    const ajeno = runInNewContext("new Date(Date.UTC(2026, 10, 16, 7, 0, 0))") as Date;
    expect(ajeno instanceof Date).toBe(false);
    expect(fechaDeNegocio(ajeno, AR, "04:00")).toEqual({ ok: true, valor: "2026-11-16" });
  });

  it.each([[null], [undefined], [4], [{ toString: () => "04:00" }], [["04:00"]]])("una hora de corte que no es texto (%s) devuelve HORA_DE_CORTE_INVALIDA y no lanza", (malo) => {
    expect(fechaDeNegocio(new Date("2026-11-16T12:00:00Z"), AR, malo as unknown as string)).toEqual({ ok: false, error: "HORA_DE_CORTE_INVALIDA" });
  });

  it.each([[null], [undefined], [3], [{ toString: () => "UTC" }], [["UTC"]]])("una zona que no es texto (%s) devuelve ZONA_HORARIA_INVALIDA y no lanza", (malo) => {
    expect(fechaDeNegocio(new Date("2026-11-16T12:00:00Z"), malo as unknown as string, "00:00")).toEqual({ ok: false, error: "ZONA_HORARIA_INVALIDA" });
  });

  it("GMT y EST5EDT se rechazan (forma canónica de Pedernal: UTC o Continente/Ciudad); Etc/GMT+3 y Etc/UTC valen", () => {
    for (const zona of ["GMT", "EST5EDT", "PST8PDT"]) expect(en("2026-11-16T12:00:00Z", zona, "00:00")).toEqual({ ok: false, error: "ZONA_HORARIA_INVALIDA" });
    expect(en("2026-11-16T12:00:00Z", "Etc/GMT+3", "00:00")).toEqual({ ok: true, valor: "2026-11-16" });
    expect(en("2026-11-16T12:00:00Z", "Etc/UTC", "00:00")).toEqual({ ok: true, valor: "2026-11-16" });
  });

  it("los límites del rango entran", () => {
    expect(fechaDeNegocio(new Date(INSTANTE_MINIMO), "UTC", "00:00").ok).toBe(true);
    expect(fechaDeNegocio(new Date(INSTANTE_MAXIMO), "UTC", "00:00").ok).toBe(true);
  });
});

describe("fechaDeNegocio: propiedades contra un cálculo independiente", () => {
  const RUNS = { numRuns: 1500 };
  const instante = fc.integer({ min: Date.parse("2000-01-01T00:00:00Z"), max: Date.parse("2100-01-01T00:00:00Z") });
  const corte = fc.tuple(fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 })).map(([h, m]) => ({ texto: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`, minutos: h * 60 + m }));

  it("en una zona SIN horario de verano es el día civil del instante corrido por el corte", () => {
    fc.assert(
      fc.property(instante, corte, (ms, c) => {
        const esperado = diaDeCalendario(new Date(ms - c.minutos * 60_000), AR);
        expect(fechaDeNegocio(new Date(ms), AR, c.texto)).toEqual({ ok: true, valor: esperado });
      }),
      RUNS,
    );
  });

  it("con corte 00:00 es el día civil de la zona, en cualquier zona (también con horario de verano)", () => {
    fc.assert(
      fc.property(instante, fc.constantFrom(AR, "UTC", "America/New_York", "Europe/Madrid", "Asia/Kolkata", "Australia/Sydney"), (ms, zona) => {
        expect(fechaDeNegocio(new Date(ms), zona, "00:00")).toEqual({ ok: true, valor: diaDeCalendario(new Date(ms), zona) });
      }),
      RUNS,
    );
  });

  it("es monótona: un instante posterior nunca da una jornada anterior", () => {
    fc.assert(
      fc.property(instante, fc.integer({ min: 0, max: 7 * 24 * 3600 * 1000 }), corte, (ms, delta, c) => {
        const a = fechaDeNegocio(new Date(ms), AR, c.texto);
        const b = fechaDeNegocio(new Date(ms + delta), AR, c.texto);
        expect(a.ok && b.ok && b.valor >= a.valor).toBe(true);
      }),
      RUNS,
    );
  });
});
