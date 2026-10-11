import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ZONA_ARGENTINA, ZONA_UTC, diaDeCalendario, rangoDeDias } from "../../src/core/tiempo/zona-horaria";
import { resolverRangoPorDefecto, resolverRangoDeReporte, ETIQUETA_RANGO, MAXIMO_DE_DIAS_DE_UN_RANGO } from "../../src/core/reportes/rango-por-defecto";

describe("resolverRangoPorDefecto", () => {
  it("sin parámetro (o cualquier valor que no sea 'mes') da los últimos 30 días, hoy inclusive", () => {
    const r = resolverRangoPorDefecto(undefined, new Date("2026-09-22T15:30:00Z"), ZONA_ARGENTINA);
    expect(r.opcion).toBe("30d");
    expect(r.hastaISO).toBe("2026-09-22");
    expect(r.desdeISO).toBe("2026-08-24"); // 29 días atrás + hoy = 30
  });

  it("'mes' da desde el día 1 del mes en curso hasta hoy", () => {
    const r = resolverRangoPorDefecto("mes", new Date("2026-09-22T15:30:00Z"), ZONA_ARGENTINA);
    expect(r.opcion).toBe("mes");
    expect(r.desdeISO).toBe("2026-09-01");
    expect(r.hastaISO).toBe("2026-09-22");
  });

  it("el día 1 del mes, 'mes' da un rango de un solo día", () => {
    const r = resolverRangoPorDefecto("mes", new Date("2026-09-01T08:00:00Z"), ZONA_ARGENTINA);
    expect(r.desdeISO).toBe("2026-09-01");
    expect(r.hastaISO).toBe("2026-09-01");
  });

  it("cruza de mes correctamente: 30 días atrás desde el 5 de marzo cae en febrero", () => {
    const r = resolverRangoPorDefecto("30d", new Date("2026-03-05T15:00:00Z"), ZONA_ARGENTINA); // 12:00 del 5/3 en Argentina
    expect(r.desdeISO).toBe("2026-02-04");
    expect(r.hastaISO).toBe("2026-03-05");
  });

  it("cruza de año: 30 días atrás desde el 10 de enero cae en diciembre del año anterior", () => {
    const r = resolverRangoPorDefecto("30d", new Date("2026-01-10T15:00:00Z"), ZONA_ARGENTINA); // 12:00 del 10/1 en Argentina
    expect(r.desdeISO).toBe("2025-12-12");
    expect(r.hastaISO).toBe("2026-01-10");
  });

  it("febrero: 'mes' con año bisiesto llega hasta el día en curso, no se pasa de mes", () => {
    const r = resolverRangoPorDefecto("mes", new Date("2028-02-29T12:00:00Z"), ZONA_ARGENTINA); // 2028 es bisiesto
    expect(r.desdeISO).toBe("2028-02-01");
    expect(r.hastaISO).toBe("2028-02-29");
  });

  it("«hoy» es el día de la ZONA, no el de UTC: a las 23:59 UTC todavía es el mismo día en Argentina", () => {
    const r = resolverRangoPorDefecto("30d", new Date("2026-09-22T23:59:00Z"), ZONA_ARGENTINA); // 20:59 del 22/9 en Argentina
    expect(r.hastaISO).toBe("2026-09-22");
  });
});

/**
 * P1 (O.251), «el día en hora argentina»: desde las 21:00 argentinas ya es el día siguiente en UTC. Con «hoy» en UTC el rango por defecto terminaba mañana (y, cortado en hora argentina, dejaba la
 * noche de hoy en un día que el selector no mostraba). Relojes FIJOS e inyectados (`ahora`); nunca se mezclan con el real.
 */
describe("resolverRangoPorDefecto: «hoy» en hora argentina (U5)", () => {
  it("a las 22:30 argentinas del 30/9 (01:30 UTC del 1/10) el rango termina el 30/9, no el 1/10", () => {
    const ahora = new Date("2026-10-01T01:30:00Z");
    expect(resolverRangoPorDefecto(undefined, ahora, ZONA_ARGENTINA)).toEqual({ opcion: "30d", desdeISO: "2026-09-01", hastaISO: "2026-09-30" });
    expect(resolverRangoDeReporte({}, ahora, ZONA_ARGENTINA)).toEqual({ opcion: "30d", desdeISO: "2026-09-01", hastaISO: "2026-09-30" });
  });

  it("«mes en curso» a las 23:59 del 30/9 sigue siendo septiembre; a las 00:00 del 1/10 pasa a octubre (el límite exacto es la medianoche argentina, las 03:00 UTC)", () => {
    expect(resolverRangoPorDefecto("mes", new Date("2026-10-01T02:59:00Z"), ZONA_ARGENTINA)).toEqual({ opcion: "mes", desdeISO: "2026-09-01", hastaISO: "2026-09-30" });
    expect(resolverRangoPorDefecto("mes", new Date("2026-10-01T03:00:00Z"), ZONA_ARGENTINA)).toEqual({ opcion: "mes", desdeISO: "2026-10-01", hastaISO: "2026-10-01" });
  });

  it("31/12 a las 22:00 argentinas (01:00 UTC del 1/1): sigue siendo diciembre y el año no cambia", () => {
    const ahora = new Date("2027-01-01T01:00:00Z");
    expect(resolverRangoPorDefecto("mes", ahora, ZONA_ARGENTINA)).toEqual({ opcion: "mes", desdeISO: "2026-12-01", hastaISO: "2026-12-31" });
    expect(resolverRangoPorDefecto("30d", ahora, ZONA_ARGENTINA)).toEqual({ opcion: "30d", desdeISO: "2026-12-02", hastaISO: "2026-12-31" });
  });

  it("29/2/2028 (bisiesto) a las 22:00 argentinas (01:00 UTC del 1/3): sigue siendo el 29 de febrero", () => {
    const ahora = new Date("2028-03-01T01:00:00Z");
    expect(resolverRangoPorDefecto("mes", ahora, ZONA_ARGENTINA)).toEqual({ opcion: "mes", desdeISO: "2028-02-01", hastaISO: "2028-02-29" });
    expect(resolverRangoPorDefecto("30d", ahora, ZONA_ARGENTINA)).toEqual({ opcion: "30d", desdeISO: "2028-01-31", hastaISO: "2028-02-29" });
  });

  it("la zona es un parámetro, no una constante: el mismo instante es otro día en Tokio (UTC+9) y en Nueva York (UTC−4)", () => {
    const ahora = new Date("2026-10-01T01:30:00Z");
    expect(resolverRangoPorDefecto(undefined, ahora, "Asia/Tokyo").hastaISO).toBe("2026-10-01"); // 10:30 del 1/10
    expect(resolverRangoPorDefecto(undefined, ahora, "America/New_York").hastaISO).toBe("2026-09-30"); // 21:30 del 30/9
    expect(resolverRangoPorDefecto(undefined, ahora, ZONA_UTC).hastaISO).toBe("2026-10-01");
  });

  /** El rango que ve la pantalla, cortado con la MISMA zona con la que se calculó «hoy», contiene el instante «ahora»: lo vendido en este momento entra en el rango por defecto. */
  const ZONAS = [ZONA_ARGENTINA, "America/New_York", "Asia/Tokyo", "Asia/Kolkata", ZONA_UTC];
  const instante = fc.integer({ min: 0, max: 8 * 365 * 24 * 60 }).map((minutos) => new Date(Date.UTC(2024, 0, 1) + minutos * 60_000));
  const contiene = (r: { desdeISO: string; hastaISO: string }, ahora: Date, zona: string) => {
    const { desde, hasta } = rangoDeDias(new Date(r.desdeISO), new Date(r.hastaISO), zona);
    return desde.getTime() <= ahora.getTime() && ahora.getTime() <= hasta.getTime();
  };

  it("propiedad: el rango por defecto («30d», «mes» y el de resolverRangoDeReporte), cortado con la misma zona, contiene a `ahora`", () => {
    fc.assert(
      fc.property(instante, fc.constantFrom(...ZONAS), (ahora, zona) => {
        expect(contiene(resolverRangoPorDefecto(undefined, ahora, zona), ahora, zona)).toBe(true);
        expect(contiene(resolverRangoPorDefecto("mes", ahora, zona), ahora, zona)).toBe(true);
        expect(contiene(resolverRangoDeReporte({}, ahora, zona), ahora, zona)).toBe(true);
        expect(contiene(resolverRangoDeReporte({ rango: "mes" }, ahora, zona), ahora, zona)).toBe(true);
      }),
      { numRuns: 1000 }
    );
  });

  it("propiedad: el «hasta» por defecto es EXACTAMENTE el día de `ahora` en la zona (ni uno antes ni uno después), y el rango de 30 días tiene 30 días", () => {
    fc.assert(
      fc.property(instante, fc.constantFrom(...ZONAS), (ahora, zona) => {
        const r = resolverRangoPorDefecto(undefined, ahora, zona);
        expect(r.hastaISO).toBe(diaDeCalendario(ahora, zona));
        expect((Date.parse(r.hastaISO) - Date.parse(r.desdeISO)) / 86_400_000).toBe(29);
      }),
      { numRuns: 500 }
    );
  });
});

describe("resolverRangoDeReporte", () => {
  const ahora = new Date("2026-09-22T12:00:00Z");

  it("sin ningún searchParam, cae al default de 30 días", () => {
    const r = resolverRangoDeReporte({}, ahora, ZONA_ARGENTINA);
    expect(r).toEqual({ opcion: "30d", desdeISO: "2026-08-24", hastaISO: "2026-09-22" });
  });

  it("rango=mes sin fechas explícitas da el mes en curso", () => {
    const r = resolverRangoDeReporte({ rango: "mes" }, ahora, ZONA_ARGENTINA);
    expect(r.opcion).toBe("mes");
    expect(r.desdeISO).toBe("2026-09-01");
  });

  it("desde explícito manda siempre, sin importar 'rango' — compatibilidad con enlaces y specs existentes", () => {
    const r = resolverRangoDeReporte({ desde: "2024-03-01", hasta: "2024-03-31", rango: "mes" }, ahora, ZONA_ARGENTINA);
    expect(r).toEqual({ opcion: "personalizado", desdeISO: "2024-03-01", hastaISO: "2024-03-31" });
  });

  it("desde sin hasta usa hoy como hasta (mismo comportamiento que antes del selector)", () => {
    // S-28: el ejemplo era de 2024 (935 días hasta hoy) y el rango ya no pasa de 366 días; uno dentro del tope conserva el comportamiento.
    const r = resolverRangoDeReporte({ desde: "2026-03-01" }, ahora, ZONA_ARGENTINA);
    expect(r).toEqual({ opcion: "personalizado", desdeISO: "2026-03-01", hastaISO: "2026-09-22" });
  });

  it("desde inválido se ignora y cae al rango por defecto (antes pasaba tal cual y el reporte lanzaba un RangeError)", () => {
    const r = resolverRangoDeReporte({ desde: "no-es-una-fecha" }, ahora, ZONA_ARGENTINA);
    expect(r).toEqual({ opcion: "30d", desdeISO: "2026-08-24", hastaISO: "2026-09-22" });
  });

  it("rango=personalizado sin fechas (primer submit al elegir 'Fechas personalizadas') no cae a 30d: queda 'personalizado' con los 30 días como punto de partida para editar", () => {
    const r = resolverRangoDeReporte({ rango: "personalizado" }, ahora, ZONA_ARGENTINA);
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
    const r = resolverRangoDeReporte({ desde: "2000-01-01" }, ahora, ZONA_ARGENTINA);
    expect(r.opcion).toBe("personalizado");
    expect(r.hastaISO).toBe("2026-09-22");
    expect(r.desdeISO).toBe("2025-09-22");
    expect(diasDelRango(r)).toBe(MAXIMO_DE_DIAS_DE_UN_RANGO);
  });

  it("un rango explícito largo, con «hasta» propio, también se recorta contra el «hasta»", () => {
    const r = resolverRangoDeReporte({ desde: "2020-01-01", hasta: "2024-12-31" }, ahora, ZONA_ARGENTINA);
    expect(r).toEqual({ opcion: "personalizado", desdeISO: "2024-01-01", hastaISO: "2024-12-31", recortadoDesde: "2020-01-01" });
  });

  it("el borde: exactamente 366 días pasan enteros; 367 se recortan a 366", () => {
    expect(resolverRangoDeReporte({ desde: "2025-09-22", hasta: "2026-09-22" }, ahora, ZONA_ARGENTINA)).toEqual({ opcion: "personalizado", desdeISO: "2025-09-22", hastaISO: "2026-09-22" });
    expect(resolverRangoDeReporte({ desde: "2025-09-21", hasta: "2026-09-22" }, ahora, ZONA_ARGENTINA)).toEqual({ opcion: "personalizado", desdeISO: "2025-09-22", hastaISO: "2026-09-22", recortadoDesde: "2025-09-21" });
  });

  // M-21 (T16): el recorte no avisaba; solo cambiaba la fecha que muestra el selector. Ahora el rango dice qué «desde» se pidió (la pantalla lo muestra: `selector-rango-aviso.test.tsx`).
  it("EL DEFECTO (M-21): cuando recorta, el rango trae el «desde» pedido; cuando entra entero, NO trae la marca", () => {
    expect(resolverRangoDeReporte({ desde: "2000-01-01" }, ahora, ZONA_ARGENTINA).recortadoDesde).toBe("2000-01-01");
    expect(resolverRangoDeReporte({ desde: "2025-09-22", hasta: "2026-09-22" }, ahora, ZONA_ARGENTINA)).not.toHaveProperty("recortadoDesde");
    expect(resolverRangoDeReporte({ rango: "personalizado" }, ahora, ZONA_ARGENTINA)).not.toHaveProperty("recortadoDesde");
    expect(resolverRangoDeReporte({ rango: "mes" }, ahora, ZONA_ARGENTINA)).not.toHaveProperty("recortadoDesde");
    expect(resolverRangoDeReporte({ desde: "no-es-una-fecha" }, ahora, ZONA_ARGENTINA)).not.toHaveProperty("recortadoDesde");
  });

  it("un rango al revés no se toca (el reporte sale vacío); lo que no es una fecha se ignora (ver «fecha inválida» abajo)", () => {
    expect(resolverRangoDeReporte({ desde: "2026-09-22", hasta: "2020-01-01" }, ahora, ZONA_ARGENTINA)).toEqual({ opcion: "personalizado", desdeISO: "2026-09-22", hastaISO: "2020-01-01" });
  });

  it("propiedad: con cualquier par de fechas válidas, el rango resuelto nunca abarca más de 366 días ni cambia el «hasta»", () => {
    const fecha = fc.date({ min: new Date("1900-01-01T00:00:00Z"), max: new Date("2200-01-01T00:00:00Z"), noInvalidDate: true }).map((d) => d.toISOString().slice(0, 10));
    fc.assert(
      fc.property(fecha, fecha, (desde, hasta) => {
        const r = resolverRangoDeReporte({ desde, hasta }, ahora, ZONA_ARGENTINA);
        expect(r.hastaISO).toBe(hasta);
        if (Date.parse(desde) <= Date.parse(hasta)) expect(diasDelRango(r)).toBeLessThanOrEqual(MAXIMO_DE_DIAS_DE_UN_RANGO);
        else expect(r.desdeISO).toBe(desde);
      }),
      { numRuns: 500 },
    );
  });

  it("propiedad: solo «desde» (el «hasta» es hoy) tampoco pasa de 366 días", () => {
    const fecha = fc.date({ min: new Date("1900-01-01T00:00:00Z"), max: new Date("2026-09-22T00:00:00Z"), noInvalidDate: true }).map((d) => d.toISOString().slice(0, 10));
    fc.assert(fc.property(fecha, (desde) => diasDelRango(resolverRangoDeReporte({ desde }, ahora, ZONA_ARGENTINA)) <= MAXIMO_DE_DIAS_DE_UN_RANGO), { numRuns: 300 });
  });

  it("los rangos por defecto («30d», «mes») y los que ya entraban en el tope no cambian", () => {
    expect(resolverRangoDeReporte({}, ahora, ZONA_ARGENTINA)).toEqual({ opcion: "30d", desdeISO: "2026-08-24", hastaISO: "2026-09-22" });
    expect(resolverRangoDeReporte({ desde: "2026-01-01", hasta: "2026-06-30" }, ahora, ZONA_ARGENTINA)).toEqual({ opcion: "personalizado", desdeISO: "2026-01-01", hastaISO: "2026-06-30" });
  });
});

/**
 * Fecha inválida en la URL (`/reportes/periodo?desde=2026-13-45`): antes el rango salía con el texto crudo, la página hacía `new Date(texto)` (Invalid Date) y `rangoDeDias` lanzaba un
 * RangeError que tumbaba la pantalla. Reloj FIJO e inyectado (`ahora`); nunca se mezcla con el real.
 */
describe("resolverRangoDeReporte: fecha inválida en la URL (el reporte no lanza)", () => {
  const ahora = new Date("2026-09-22T12:00:00Z");
  const POR_DEFECTO = { opcion: "30d", desdeISO: "2026-08-24", hastaISO: "2026-09-22" };

  /** Lo que hace la página con el rango: `new Date(iso)` de cada extremo y `rangoDeDias` (donde se lanzaba el RangeError). */
  const comoLoConsumeElReporte = (r: { desdeISO: string; hastaISO: string }) => rangoDeDias(new Date(r.desdeISO), new Date(r.hastaISO), ZONA_ARGENTINA);

  it.each([
    ["fecha inexistente (31 de febrero)", "2026-02-31"],
    ["mes 13 y día 45", "2026-13-45"],
    ["texto", "abc"],
    ["texto largo", "no-es-una-fecha"],
    ["vacío", ""],
    ["formato sin ceros", "2026-9-1"],
  ])("«desde» inválido (%s) cae al rango por defecto y el reporte puede consumirlo", (_caso, desde) => {
    const r = resolverRangoDeReporte({ desde }, ahora, ZONA_ARGENTINA);
    expect(r).toEqual(POR_DEFECTO);
    expect(() => comoLoConsumeElReporte(r)).not.toThrow();
  });

  it("«desde» inválido respeta «rango=mes»: cae al mes en curso, no a 30 días", () => {
    expect(resolverRangoDeReporte({ desde: "2026-13-45", rango: "mes" }, ahora, ZONA_ARGENTINA)).toEqual({ opcion: "mes", desdeISO: "2026-09-01", hastaISO: "2026-09-22" });
  });

  it("«desde» inválido con «hasta» válido: se ignoran los dos, cae al rango por defecto", () => {
    const r = resolverRangoDeReporte({ desde: "abc", hasta: "2026-09-10" }, ahora, ZONA_ARGENTINA);
    expect(r).toEqual(POR_DEFECTO);
    expect(() => comoLoConsumeElReporte(r)).not.toThrow();
  });

  it.each([
    ["fecha inexistente (31 de febrero)", "2026-02-31"],
    ["mes 13 y día 45", "2026-13-45"],
    ["texto", "abc"],
    ["vacío", ""],
  ])("solo «hasta» inválido (%s) con «desde» válido: «hasta» pasa a hoy y «desde» se respeta", (_caso, hasta) => {
    const r = resolverRangoDeReporte({ desde: "2026-09-01", hasta }, ahora, ZONA_ARGENTINA);
    expect(r).toEqual({ opcion: "personalizado", desdeISO: "2026-09-01", hastaISO: "2026-09-22" });
    expect(() => comoLoConsumeElReporte(r)).not.toThrow();
  });

  it("solo «hasta» inválido, sin «desde»: rango por defecto", () => {
    const r = resolverRangoDeReporte({ hasta: "2026-02-31" }, ahora, ZONA_ARGENTINA);
    expect(r).toEqual(POR_DEFECTO);
    expect(() => comoLoConsumeElReporte(r)).not.toThrow();
  });

  it("«rango=personalizado» con «desde» inválido sigue siendo personalizado, con los 30 días como punto de partida", () => {
    expect(resolverRangoDeReporte({ rango: "personalizado", desde: "abc" }, ahora, ZONA_ARGENTINA)).toEqual({ opcion: "personalizado", desdeISO: "2026-08-24", hastaISO: "2026-09-22" });
  });

  it("una fecha válida sigue igual (también el 29 de febrero de un año bisiesto)", () => {
    expect(resolverRangoDeReporte({ desde: "2026-09-01", hasta: "2026-09-10" }, ahora, ZONA_ARGENTINA)).toEqual({ opcion: "personalizado", desdeISO: "2026-09-01", hastaISO: "2026-09-10" });
    expect(resolverRangoDeReporte({ desde: "2024-02-29", hasta: "2024-03-10" }, ahora, ZONA_ARGENTINA)).toEqual({ opcion: "personalizado", desdeISO: "2024-02-29", hastaISO: "2024-03-10" });
  });
});

describe("ETIQUETA_RANGO", () => {
  it("tiene una etiqueta en prosa para cada opción con default (no para 'personalizado', que no tiene una frase fija)", () => {
    expect(ETIQUETA_RANGO["30d"]).toBe("los últimos 30 días");
    expect(ETIQUETA_RANGO.mes).toBe("el mes en curso");
  });
});
