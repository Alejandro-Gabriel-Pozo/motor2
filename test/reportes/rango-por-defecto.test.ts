import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { rangoUtc } from "../../src/core/reportes/periodo-tipos";
import { resolverRangoPorDefecto, resolverRangoDeReporte, ETIQUETA_RANGO, MAXIMO_DE_DIAS_DE_UN_RANGO } from "../../src/core/reportes/rango-por-defecto";

describe("resolverRangoPorDefecto", () => {
  it("sin parámetro (o cualquier valor que no sea 'mes') da los últimos 30 días, hoy inclusive", () => {
    const r = resolverRangoPorDefecto(undefined, new Date("2026-09-22T15:30:00Z"));
    expect(r.opcion).toBe("30d");
    expect(r.hastaISO).toBe("2026-09-22");
    expect(r.desdeISO).toBe("2026-08-24"); // 29 días atrás + hoy = 30
  });

  it("'mes' da desde el día 1 del mes en curso hasta hoy", () => {
    const r = resolverRangoPorDefecto("mes", new Date("2026-09-22T15:30:00Z"));
    expect(r.opcion).toBe("mes");
    expect(r.desdeISO).toBe("2026-09-01");
    expect(r.hastaISO).toBe("2026-09-22");
  });

  it("el día 1 del mes, 'mes' da un rango de un solo día", () => {
    const r = resolverRangoPorDefecto("mes", new Date("2026-09-01T08:00:00Z"));
    expect(r.desdeISO).toBe("2026-09-01");
    expect(r.hastaISO).toBe("2026-09-01");
  });

  it("cruza de mes correctamente: 30 días atrás desde el 5 de marzo cae en enero", () => {
    const r = resolverRangoPorDefecto("30d", new Date("2026-03-05T00:00:00Z"));
    expect(r.desdeISO).toBe("2026-02-04");
    expect(r.hastaISO).toBe("2026-03-05");
  });

  it("cruza de año: 30 días atrás desde el 10 de enero cae en diciembre del año anterior", () => {
    const r = resolverRangoPorDefecto("30d", new Date("2026-01-10T00:00:00Z"));
    expect(r.desdeISO).toBe("2025-12-12");
    expect(r.hastaISO).toBe("2026-01-10");
  });

  it("febrero: 'mes' con año bisiesto llega hasta el día en curso, no se pasa de mes", () => {
    const r = resolverRangoPorDefecto("mes", new Date("2028-02-29T12:00:00Z")); // 2028 es bisiesto
    expect(r.desdeISO).toBe("2028-02-01");
    expect(r.hastaISO).toBe("2028-02-29");
  });

  it("usa el día UTC, no el local: una hora tardía en UTC no corre 'hoy' al día siguiente", () => {
    const r = resolverRangoPorDefecto("30d", new Date("2026-09-22T23:59:00Z"));
    expect(r.hastaISO).toBe("2026-09-22");
  });
});

describe("resolverRangoDeReporte", () => {
  const ahora = new Date("2026-09-22T12:00:00Z");

  it("sin ningún searchParam, cae al default de 30 días", () => {
    const r = resolverRangoDeReporte({}, ahora);
    expect(r).toEqual({ opcion: "30d", desdeISO: "2026-08-24", hastaISO: "2026-09-22" });
  });

  it("rango=mes sin fechas explícitas da el mes en curso", () => {
    const r = resolverRangoDeReporte({ rango: "mes" }, ahora);
    expect(r.opcion).toBe("mes");
    expect(r.desdeISO).toBe("2026-09-01");
  });

  it("desde explícito manda siempre, sin importar 'rango' — compatibilidad con enlaces y specs existentes", () => {
    const r = resolverRangoDeReporte({ desde: "2024-03-01", hasta: "2024-03-31", rango: "mes" }, ahora);
    expect(r).toEqual({ opcion: "personalizado", desdeISO: "2024-03-01", hastaISO: "2024-03-31" });
  });

  it("desde sin hasta usa hoy como hasta (mismo comportamiento que antes del selector)", () => {
    // S-28: el ejemplo era de 2024 (935 días hasta hoy) y el rango ya no pasa de 366 días; uno dentro del tope conserva el comportamiento.
    const r = resolverRangoDeReporte({ desde: "2026-03-01" }, ahora);
    expect(r).toEqual({ opcion: "personalizado", desdeISO: "2026-03-01", hastaISO: "2026-09-22" });
  });

  it("desde inválido se ignora y cae al rango por defecto (antes pasaba tal cual y el reporte lanzaba un RangeError)", () => {
    const r = resolverRangoDeReporte({ desde: "no-es-una-fecha" }, ahora);
    expect(r).toEqual({ opcion: "30d", desdeISO: "2026-08-24", hastaISO: "2026-09-22" });
  });

  it("rango=personalizado sin fechas (primer submit al elegir 'Fechas personalizadas') no cae a 30d: queda 'personalizado' con los 30 días como punto de partida para editar", () => {
    const r = resolverRangoDeReporte({ rango: "personalizado" }, ahora);
    expect(r.opcion).toBe("personalizado");
    expect(r.desdeISO).toBe("2026-08-24");
    expect(r.hastaISO).toBe("2026-09-22");
  });
});

/** Los días que abarca un rango, contando los dos extremos. */
const diasDelRango = (r: { desdeISO: string; hastaISO: string }) => Math.round((Date.parse(r.hastaISO) - Date.parse(r.desdeISO)) / 86_400_000) + 1;

describe("resolverRangoDeReporte: nunca más de 366 días (S-28)", () => {
  const ahora = new Date("2026-09-22T12:00:00Z");

  it("EL ATAQUE: un rango de 2000 a hoy (26 años de movimientos) se recorta a los últimos 366 días, con el mismo «hasta»", () => {
    const r = resolverRangoDeReporte({ desde: "2000-01-01" }, ahora);
    expect(r.opcion).toBe("personalizado");
    expect(r.hastaISO).toBe("2026-09-22");
    expect(r.desdeISO).toBe("2025-09-22");
    expect(diasDelRango(r)).toBe(MAXIMO_DE_DIAS_DE_UN_RANGO);
  });

  it("un rango explícito largo, con «hasta» propio, también se recorta contra el «hasta»", () => {
    const r = resolverRangoDeReporte({ desde: "2020-01-01", hasta: "2024-12-31" }, ahora);
    expect(r).toEqual({ opcion: "personalizado", desdeISO: "2024-01-01", hastaISO: "2024-12-31", recortadoDesde: "2020-01-01" });
  });

  it("el borde: exactamente 366 días pasan enteros; 367 se recortan a 366", () => {
    expect(resolverRangoDeReporte({ desde: "2025-09-22", hasta: "2026-09-22" }, ahora)).toEqual({ opcion: "personalizado", desdeISO: "2025-09-22", hastaISO: "2026-09-22" });
    expect(resolverRangoDeReporte({ desde: "2025-09-21", hasta: "2026-09-22" }, ahora)).toEqual({ opcion: "personalizado", desdeISO: "2025-09-22", hastaISO: "2026-09-22", recortadoDesde: "2025-09-21" });
  });

  // M-21 (T16): el recorte no avisaba; solo cambiaba la fecha que muestra el selector. Ahora el rango dice qué «desde» se pidió (la pantalla lo muestra: `selector-rango-aviso.test.tsx`).
  it("EL DEFECTO (M-21): cuando recorta, el rango trae el «desde» pedido; cuando entra entero, NO trae la marca", () => {
    expect(resolverRangoDeReporte({ desde: "2000-01-01" }, ahora).recortadoDesde).toBe("2000-01-01");
    expect(resolverRangoDeReporte({ desde: "2025-09-22", hasta: "2026-09-22" }, ahora)).not.toHaveProperty("recortadoDesde");
    expect(resolverRangoDeReporte({ rango: "personalizado" }, ahora)).not.toHaveProperty("recortadoDesde");
    expect(resolverRangoDeReporte({ rango: "mes" }, ahora)).not.toHaveProperty("recortadoDesde");
    expect(resolverRangoDeReporte({ desde: "no-es-una-fecha" }, ahora)).not.toHaveProperty("recortadoDesde");
  });

  it("un rango al revés no se toca (el reporte sale vacío); lo que no es una fecha se ignora (ver «fecha inválida» abajo)", () => {
    expect(resolverRangoDeReporte({ desde: "2026-09-22", hasta: "2020-01-01" }, ahora)).toEqual({ opcion: "personalizado", desdeISO: "2026-09-22", hastaISO: "2020-01-01" });
  });

  it("propiedad: con cualquier par de fechas válidas, el rango resuelto nunca abarca más de 366 días ni cambia el «hasta»", () => {
    const fecha = fc.date({ min: new Date("1900-01-01T00:00:00Z"), max: new Date("2200-01-01T00:00:00Z"), noInvalidDate: true }).map((d) => d.toISOString().slice(0, 10));
    fc.assert(
      fc.property(fecha, fecha, (desde, hasta) => {
        const r = resolverRangoDeReporte({ desde, hasta }, ahora);
        expect(r.hastaISO).toBe(hasta);
        if (Date.parse(desde) <= Date.parse(hasta)) expect(diasDelRango(r)).toBeLessThanOrEqual(MAXIMO_DE_DIAS_DE_UN_RANGO);
        else expect(r.desdeISO).toBe(desde);
      }),
      { numRuns: 500 },
    );
  });

  it("propiedad: solo «desde» (el «hasta» es hoy) tampoco pasa de 366 días", () => {
    const fecha = fc.date({ min: new Date("1900-01-01T00:00:00Z"), max: new Date("2026-09-22T00:00:00Z"), noInvalidDate: true }).map((d) => d.toISOString().slice(0, 10));
    fc.assert(fc.property(fecha, (desde) => diasDelRango(resolverRangoDeReporte({ desde }, ahora)) <= MAXIMO_DE_DIAS_DE_UN_RANGO), { numRuns: 300 });
  });

  it("los rangos por defecto («30d», «mes») y los que ya entraban en el tope no cambian", () => {
    expect(resolverRangoDeReporte({}, ahora)).toEqual({ opcion: "30d", desdeISO: "2026-08-24", hastaISO: "2026-09-22" });
    expect(resolverRangoDeReporte({ desde: "2026-01-01", hasta: "2026-06-30" }, ahora)).toEqual({ opcion: "personalizado", desdeISO: "2026-01-01", hastaISO: "2026-06-30" });
  });
});

/**
 * Fecha inválida en la URL (`/reportes/periodo?desde=2026-13-45`): antes el rango salía con el texto crudo, la página hacía `new Date(texto)` (Invalid Date) y `rangoUtc` lanzaba un
 * RangeError que tumbaba la pantalla. Reloj FIJO e inyectado (`ahora`); nunca se mezcla con el real.
 */
describe("resolverRangoDeReporte: fecha inválida en la URL (el reporte no lanza)", () => {
  const ahora = new Date("2026-09-22T12:00:00Z");
  const POR_DEFECTO = { opcion: "30d", desdeISO: "2026-08-24", hastaISO: "2026-09-22" };

  /** Lo que hace la página con el rango: `new Date(iso)` de cada extremo y `rangoUtc` (donde se lanzaba el RangeError). */
  const comoLoConsumeElReporte = (r: { desdeISO: string; hastaISO: string }) => rangoUtc(new Date(r.desdeISO), new Date(r.hastaISO));

  it.each([
    ["fecha inexistente (31 de febrero)", "2026-02-31"],
    ["mes 13 y día 45", "2026-13-45"],
    ["texto", "abc"],
    ["texto largo", "no-es-una-fecha"],
    ["vacío", ""],
    ["formato sin ceros", "2026-9-1"],
  ])("«desde» inválido (%s) cae al rango por defecto y el reporte puede consumirlo", (_caso, desde) => {
    const r = resolverRangoDeReporte({ desde }, ahora);
    expect(r).toEqual(POR_DEFECTO);
    expect(() => comoLoConsumeElReporte(r)).not.toThrow();
  });

  it("«desde» inválido respeta «rango=mes»: cae al mes en curso, no a 30 días", () => {
    expect(resolverRangoDeReporte({ desde: "2026-13-45", rango: "mes" }, ahora)).toEqual({ opcion: "mes", desdeISO: "2026-09-01", hastaISO: "2026-09-22" });
  });

  it("«desde» inválido con «hasta» válido: se ignoran los dos, cae al rango por defecto", () => {
    const r = resolverRangoDeReporte({ desde: "abc", hasta: "2026-09-10" }, ahora);
    expect(r).toEqual(POR_DEFECTO);
    expect(() => comoLoConsumeElReporte(r)).not.toThrow();
  });

  it.each([
    ["fecha inexistente (31 de febrero)", "2026-02-31"],
    ["mes 13 y día 45", "2026-13-45"],
    ["texto", "abc"],
    ["vacío", ""],
  ])("solo «hasta» inválido (%s) con «desde» válido: «hasta» pasa a hoy y «desde» se respeta", (_caso, hasta) => {
    const r = resolverRangoDeReporte({ desde: "2026-09-01", hasta }, ahora);
    expect(r).toEqual({ opcion: "personalizado", desdeISO: "2026-09-01", hastaISO: "2026-09-22" });
    expect(() => comoLoConsumeElReporte(r)).not.toThrow();
  });

  it("solo «hasta» inválido, sin «desde»: rango por defecto", () => {
    const r = resolverRangoDeReporte({ hasta: "2026-02-31" }, ahora);
    expect(r).toEqual(POR_DEFECTO);
    expect(() => comoLoConsumeElReporte(r)).not.toThrow();
  });

  it("«rango=personalizado» con «desde» inválido sigue siendo personalizado, con los 30 días como punto de partida", () => {
    expect(resolverRangoDeReporte({ rango: "personalizado", desde: "abc" }, ahora)).toEqual({ opcion: "personalizado", desdeISO: "2026-08-24", hastaISO: "2026-09-22" });
  });

  it("una fecha válida sigue igual (también el 29 de febrero de un año bisiesto)", () => {
    expect(resolverRangoDeReporte({ desde: "2026-09-01", hasta: "2026-09-10" }, ahora)).toEqual({ opcion: "personalizado", desdeISO: "2026-09-01", hastaISO: "2026-09-10" });
    expect(resolverRangoDeReporte({ desde: "2024-02-29", hasta: "2024-03-10" }, ahora)).toEqual({ opcion: "personalizado", desdeISO: "2024-02-29", hastaISO: "2024-03-10" });
  });
});

describe("ETIQUETA_RANGO", () => {
  it("tiene una etiqueta en prosa para cada opción con default (no para 'personalizado', que no tiene una frase fija)", () => {
    expect(ETIQUETA_RANGO["30d"]).toBe("los últimos 30 días");
    expect(ETIQUETA_RANGO.mes).toBe("el mes en curso");
  });
});
