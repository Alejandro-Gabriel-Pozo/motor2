import { describe, expect, it } from "vitest";
import {
  ZONA_ARGENTINA,
  ZONA_UTC,
  diaDeCalendario,
  esZonaHorariaValida,
  finDelDia,
  finDelDiaDe,
  formatearFechaHora,
  formatearHora,
  horaDelDia,
  inicioDelDia,
  inicioDelDiaDe,
  rangoDeDias,
  sumarDias,
} from "../../src/core/tiempo/zona-horaria";

const iso = (d: Date) => d.toISOString();
const NY = "America/New_York";

describe("esZonaHorariaValida", () => {
  it("acepta zonas IANA", () => {
    for (const z of [ZONA_ARGENTINA, NY, "Europe/Madrid", "Asia/Kolkata", "Pacific/Auckland", "UTC"]) expect(esZonaHorariaValida(z), z).toBe(true);
  });

  it("rechaza vacío, no-texto, espacios, offsets y nombres que Intl no conoce", () => {
    for (const z of ["", " ", " UTC", "UTC ", "-03:00", "+05:30", "Argentina", "America/Inventada", null, undefined, 3]) expect(esZonaHorariaValida(z), String(z)).toBe(false);
  });
});

describe("Argentina (UTC-3 fijo): los casos de borde del corte de día", () => {
  it("00:00 UTC es todavía la noche anterior; 02:59:59.999 también; 03:00 ya es el día siguiente", () => {
    expect(diaDeCalendario(new Date("2026-09-26T00:00:00.000Z"), ZONA_ARGENTINA)).toBe("2026-09-25");
    expect(diaDeCalendario(new Date("2026-09-26T02:59:59.999Z"), ZONA_ARGENTINA)).toBe("2026-09-25");
    expect(diaDeCalendario(new Date("2026-09-26T03:00:00.000Z"), ZONA_ARGENTINA)).toBe("2026-09-26");
  });

  it("inicio y fin de un día son 03:00:00.000 UTC de ese día y 02:59:59.999 UTC del siguiente", () => {
    expect(iso(inicioDelDia("2026-09-26", ZONA_ARGENTINA))).toBe("2026-09-26T03:00:00.000Z");
    expect(iso(finDelDia("2026-09-26", ZONA_ARGENTINA))).toBe("2026-09-27T02:59:59.999Z");
  });

  it("una cuenta de las 21:30 y otra de las 00:15 del día siguiente (a ambos lados de la medianoche UTC) caen cada una en su día", () => {
    const finDelServicio = new Date("2026-09-27T00:30:00.000Z");
    const yaDeMadrugada = new Date("2026-09-27T03:15:00.000Z");
    expect(diaDeCalendario(finDelServicio, ZONA_ARGENTINA)).toBe("2026-09-26");
    expect(diaDeCalendario(yaDeMadrugada, ZONA_ARGENTINA)).toBe("2026-09-27");
    expect(finDelServicio >= inicioDelDia("2026-09-26", ZONA_ARGENTINA) && finDelServicio <= finDelDia("2026-09-26", ZONA_ARGENTINA)).toBe(true);
    expect(yaDeMadrugada >= inicioDelDia("2026-09-27", ZONA_ARGENTINA) && yaDeMadrugada <= finDelDia("2026-09-27", ZONA_ARGENTINA)).toBe(true);
  });

  it("coincide con el offset fijo de siempre en todo el año (incluido fin de año y bisiesto)", () => {
    for (const dia of ["2026-01-01", "2026-12-31", "2028-02-29", "2026-07-15"]) {
      expect(iso(inicioDelDia(dia, ZONA_ARGENTINA)), dia).toBe(iso(new Date(`${dia}T00:00:00.000-03:00`)));
      expect(iso(finDelDia(dia, ZONA_ARGENTINA)), dia).toBe(iso(new Date(`${dia}T23:59:59.999-03:00`)));
    }
  });
});

describe("otras zonas", () => {
  it("Nueva York cambia de offset con el horario de verano: el día del cambio dura 23 h y el del regreso 25 h", () => {
    // 2026-03-08: se adelanta la hora (UTC-5 → UTC-4). 2026-11-01: se atrasa (UTC-4 → UTC-5).
    expect(iso(inicioDelDia("2026-03-08", NY))).toBe("2026-03-08T05:00:00.000Z");
    expect(iso(finDelDia("2026-03-08", NY))).toBe("2026-03-09T03:59:59.999Z");
    expect(iso(inicioDelDia("2026-11-01", NY))).toBe("2026-11-01T04:00:00.000Z");
    expect(iso(finDelDia("2026-11-01", NY))).toBe("2026-11-02T04:59:59.999Z");
    const horas = (dia: string) => (finDelDia(dia, NY).getTime() + 1 - inicioDelDia(dia, NY).getTime()) / 3_600_000;
    expect(horas("2026-03-08")).toBe(23);
    expect(horas("2026-11-01")).toBe(25);
    expect(horas("2026-06-15")).toBe(24);
  });

  it("zonas al este de UTC: Auckland (+13 en octubre) y Calcuta (+5:30)", () => {
    expect(iso(inicioDelDia("2026-10-03", "Pacific/Auckland"))).toBe("2026-10-02T11:00:00.000Z");
    expect(iso(inicioDelDia("2026-10-03", "Asia/Kolkata"))).toBe("2026-10-02T18:30:00.000Z");
    expect(iso(finDelDia("2026-10-03", "Asia/Kolkata"))).toBe("2026-10-03T18:29:59.999Z");
    expect(diaDeCalendario(new Date("2026-10-02T18:30:00.000Z"), "Asia/Kolkata")).toBe("2026-10-03");
    expect(diaDeCalendario(new Date("2026-10-02T18:29:59.999Z"), "Asia/Kolkata")).toBe("2026-10-02");
  });

  it("el mismo instante es de días distintos según la zona", () => {
    const instante = new Date("2026-09-26T02:00:00.000Z");
    expect(diaDeCalendario(instante, ZONA_UTC)).toBe("2026-09-26");
    expect(diaDeCalendario(instante, ZONA_ARGENTINA)).toBe("2026-09-25");
    expect(diaDeCalendario(instante, "Pacific/Auckland")).toBe("2026-09-26");
  });

  it("inicioDelDiaDe / finDelDiaDe: los límites del día de la zona que contiene el instante", () => {
    const instante = new Date("2026-09-26T01:00:00.000Z"); // 21:00 del 25/09 en Nueva York
    expect(iso(inicioDelDiaDe(instante, NY))).toBe("2026-09-25T04:00:00.000Z");
    expect(iso(finDelDiaDe(instante, NY))).toBe("2026-09-26T03:59:59.999Z");
  });
});

describe("formatear con la zona", () => {
  const instante = new Date("2026-09-25T18:10:00.000Z");

  it("la misma hora se ve distinta según la zona", () => {
    expect(formatearFechaHora(instante, ZONA_ARGENTINA)).toBe("25/09/2026 15:10");
    expect(formatearFechaHora(instante, NY)).toBe("25/09/2026 14:10");
    expect(formatearHora(instante, ZONA_ARGENTINA)).toBe("15:10");
    expect(formatearHora(instante, NY)).toBe("14:10");
    expect(horaDelDia(instante, ZONA_ARGENTINA)).toBe(15);
    expect(horaDelDia(instante, NY)).toBe(14);
  });

  it("la medianoche es 00 (no 24) y cruza de día con la zona", () => {
    const medianoche = new Date("2026-09-26T03:05:00.000Z");
    expect(formatearFechaHora(medianoche, ZONA_ARGENTINA)).toBe("26/09/2026 00:05");
    expect(horaDelDia(medianoche, ZONA_ARGENTINA)).toBe(0);
    expect(formatearFechaHora(medianoche, NY)).toBe("25/09/2026 23:05");
  });
});

describe("UTC: lo mismo que el corte `setUTCHours` de los reportes", () => {
  it("inicio y fin de día en UTC coinciden con setUTCHours(0,0,0,0) / setUTCHours(23,59,59,999)", () => {
    for (const texto of ["2026-09-26T17:45:12.345Z", "2026-01-01T00:00:00.000Z", "2026-12-31T23:59:59.999Z", "2028-02-29T12:00:00.000Z"]) {
      const f = new Date(texto);
      const ini = new Date(f);
      ini.setUTCHours(0, 0, 0, 0);
      const fin = new Date(f);
      fin.setUTCHours(23, 59, 59, 999);
      expect(iso(inicioDelDiaDe(f, ZONA_UTC)), texto).toBe(iso(ini));
      expect(iso(finDelDiaDe(f, ZONA_UTC)), texto).toBe(iso(fin));
    }
  });

  it("rangoDeDias lee el día de las fechas «de solo día» (medianoche UTC) y recorta con la zona pedida", () => {
    const r = rangoDeDias(new Date("2026-09-01"), new Date("2026-09-30"), ZONA_UTC);
    expect(iso(r.desde)).toBe("2026-09-01T00:00:00.000Z");
    expect(iso(r.hasta)).toBe("2026-09-30T23:59:59.999Z");
    const ar = rangoDeDias(new Date("2026-09-01"), new Date("2026-09-30"), ZONA_ARGENTINA);
    expect(iso(ar.desde)).toBe("2026-09-01T03:00:00.000Z");
    expect(iso(ar.hasta)).toBe("2026-10-01T02:59:59.999Z");
  });
});

describe("sumarDias y días inválidos", () => {
  it("suma días de calendario cruzando mes, año y bisiesto", () => {
    expect(sumarDias("2026-09-30", 1)).toBe("2026-10-01");
    expect(sumarDias("2026-12-31", 1)).toBe("2027-01-01");
    expect(sumarDias("2028-02-28", 1)).toBe("2028-02-29");
    expect(sumarDias("2026-10-01", -1)).toBe("2026-09-30");
  });

  it("un día que no es AAAA-MM-DD es un error, no un Invalid Date silencioso", () => {
    expect(() => inicioDelDia("26/09/2026", ZONA_ARGENTINA)).toThrow(RangeError);
    expect(() => finDelDia("2026-9-26", ZONA_ARGENTINA)).toThrow(RangeError);
  });
});
