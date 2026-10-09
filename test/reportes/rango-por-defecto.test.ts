import fc from "fast-check";
import { describe, expect, it } from "vitest";
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

  it("desde inválido pasa igual (sin validar) — pantalla de error del reporte se hace cargo", () => {
    const r = resolverRangoDeReporte({ desde: "no-es-una-fecha" }, ahora);
    expect(r.opcion).toBe("personalizado");
    expect(r.desdeISO).toBe("no-es-una-fecha");
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
    expect(r).toEqual({ opcion: "personalizado", desdeISO: "2024-01-01", hastaISO: "2024-12-31" });
  });

  it("el borde: exactamente 366 días pasan enteros; 367 se recortan a 366", () => {
    expect(resolverRangoDeReporte({ desde: "2025-09-22", hasta: "2026-09-22" }, ahora)).toEqual({ opcion: "personalizado", desdeISO: "2025-09-22", hastaISO: "2026-09-22" });
    expect(resolverRangoDeReporte({ desde: "2025-09-21", hasta: "2026-09-22" }, ahora)).toEqual({ opcion: "personalizado", desdeISO: "2025-09-22", hastaISO: "2026-09-22" });
  });

  it("lo que no es una fecha, o un rango al revés, no se toca (el reporte se hace cargo)", () => {
    expect(resolverRangoDeReporte({ desde: "no-es-una-fecha", hasta: "2026-09-22" }, ahora).desdeISO).toBe("no-es-una-fecha");
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

describe("ETIQUETA_RANGO", () => {
  it("tiene una etiqueta en prosa para cada opción con default (no para 'personalizado', que no tiene una frase fija)", () => {
    expect(ETIQUETA_RANGO["30d"]).toBe("los últimos 30 días");
    expect(ETIQUETA_RANGO.mes).toBe("el mes en curso");
  });
});
