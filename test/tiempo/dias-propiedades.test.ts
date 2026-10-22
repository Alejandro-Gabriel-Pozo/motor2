import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ZONA_ARGENTINA, diaDeCalendario, diaDeColumnaDate, diaDeLaSemana, esDiaISOReal, fechaDeColumnaDate, finDelDia, inicioDelDia, rangoDeDias, sumarDias } from "../../src/core/tiempo/zona-horaria";

/**
 * Propiedades del día de calendario y de la zona (lote 6.33, «tipos de dato declarados y bloqueantes»): un día que escribe una persona o llega en la URL es un texto «AAAA-MM-DD»; `core/tiempo` es el único que lo lee.
 * Lo que se prueba, sin reloj real (todo se genera, ningún test mira `Date.now()` ni `new Date()` sin argumento):
 *  - ida y vuelta: texto → día de columna → texto, y texto → inicio/fin del día en una zona → día de calendario en esa zona, vuelven al mismo día;
 *  - rechazo: los días que no existen («2026-02-30», «2026-04-31», «2025-02-29») y los textos mal formados no pasan `esDiaISOReal`, aunque `new Date(texto)` los corra al día siguiente;
 *  - corte de día en la hora argentina (UTC−3 fijo): las 02:59:59.999 UTC son del día anterior y las 03:00:00.000 UTC, del día; inicio y fin de un día miden 24 h y cierran con el inicio del siguiente.
 * Los casos con ejemplos puntuales y las otras zonas (horario de verano de Nueva York, Calcuta, Sídney) están en `zona-horaria.test.ts` y `reportes/corte-de-dias.test.ts`.
 */
const UN_DIA_MS = 86_400_000;
const TRES_HORAS_MS = 3 * 3_600_000;

const dosDigitos = (n: number) => String(n).padStart(2, "0");
const diasDelMes = (anio: number, mes: number) => new Date(Date.UTC(anio, mes, 0)).getUTCDate();

/**
 * Un día que EXISTE, entre 2010 y 2060 (bisiestos incluidos; los siglos, aparte). Desde 2010: Argentina usó horario de verano hasta marzo de 2009, y la base de zonas horarias lo sabe (en 1990 el día argentino
 * empieza a las 02:00 UTC o a las 03:00 UTC según la fecha); de ahí en adelante es UTC−3 fijo, que es lo que estas propiedades afirman.
 */
const diaReal = fc
  .record({ anio: fc.integer({ min: 2010, max: 2060 }), mes: fc.integer({ min: 1, max: 12 }), dia: fc.integer({ min: 1, max: 31 }) })
  .map(({ anio, mes, dia }) => ({ anio, mes, dia: Math.min(dia, diasDelMes(anio, mes)) }))
  .map(({ anio, mes, dia }) => `${anio}-${dosDigitos(mes)}-${dosDigitos(dia)}`);

/** Un día que NO existe: el 29, 30 o 31 de un mes que no los tiene (el 29 de febrero de un año no bisiesto, el 31 de abril…). */
const diaInexistente = fc
  .record({ anio: fc.integer({ min: 2010, max: 2060 }), mes: fc.integer({ min: 1, max: 12 }), dia: fc.integer({ min: 29, max: 31 }) })
  .filter(({ anio, mes, dia }) => dia > diasDelMes(anio, mes))
  .map(({ anio, mes, dia }) => `${anio}-${dosDigitos(mes)}-${dosDigitos(dia)}`);

describe("esDiaISOReal: ida y vuelta y rechazo", () => {
  it("propiedad: todo día que existe se acepta y vuelve igual por la columna DATE (texto → Date → texto)", () => {
    fc.assert(
      fc.property(diaReal, (d) => {
        expect(esDiaISOReal(d), d).toBe(true);
        expect(diaDeColumnaDate(fechaDeColumnaDate(d)), d).toBe(d);
        expect(fechaDeColumnaDate(d).getUTCHours(), d).toBe(0); // medianoche UTC, la convención de las columnas DATE
      }),
      { numRuns: 1000 },
    );
  });

  it("propiedad: un día que no existe (29 de febrero sin bisiesto, 31 de abril…) NO se acepta, y `new Date` lo correría al mes siguiente (por eso no se usa para leerlo)", () => {
    fc.assert(
      fc.property(diaInexistente, (d) => {
        expect(esDiaISOReal(d), d).toBe(false);
        // Lo que haría `new Date(d)` si se lo usara para validar: o no es válido, o es OTRO día (nunca el mismo).
        const instante = new Date(d);
        if (!Number.isNaN(instante.getTime())) expect(instante.toISOString().slice(0, 10), d).not.toBe(d);
      }),
      { numRuns: 1000 },
    );
  });

  it("los casos que lo motivaron: 2026-02-30, 2026-04-31 y 2025-02-29 no existen; 2024-02-29 y 2000-02-29 sí (bisiestos); 1900-02-29 y 2100-02-29 no (regla de los siglos)", () => {
    for (const d of ["2026-02-30", "2026-04-31", "2025-02-29", "1900-02-29", "2100-02-29"]) expect(esDiaISOReal(d), d).toBe(false);
    for (const d of ["2024-02-29", "2000-02-29", "2026-02-28"]) expect(esDiaISOReal(d), d).toBe(true);
  });

  it("propiedad: lo que no es exactamente «AAAA-MM-DD» no se acepta (mes 13, día 00, un dígito, con hora, con espacios, vacío, no texto)", () => {
    const malFormado = fc.oneof(
      fc.constantFrom("", " ", "2026-13-01", "2026-00-10", "2026-01-00", "2026-9-1", "2026-09-1", "26-09-01", "2026/09/01", "2026-09-01T00:00:00Z", " 2026-09-01", "2026-09-01 ", "abc", "٢٠٢٦-٠٩-٠١"),
      diaReal.map((d) => `${d}x`),
      diaReal.map((d) => d.replace(/-/g, "")),
    );
    fc.assert(
      fc.property(malFormado, (t) => {
        expect(esDiaISOReal(t), JSON.stringify(t)).toBe(false);
      }),
      { numRuns: 300 },
    );
    for (const t of [null, undefined, 20260901, new Date(0), {}, []]) expect(esDiaISOReal(t)).toBe(false);
  });
});

describe("corte de día en la hora argentina (UTC−3 fijo)", () => {
  it("propiedad: el inicio del día es las 03:00:00.000 UTC de ese día, el fin es un milisegundo antes del inicio del siguiente, y entre los dos hay 24 h", () => {
    fc.assert(
      fc.property(diaReal, (d) => {
        const inicio = inicioDelDia(d, ZONA_ARGENTINA);
        const fin = finDelDia(d, ZONA_ARGENTINA);
        expect(inicio.getTime(), d).toBe(fechaDeColumnaDate(d).getTime() + TRES_HORAS_MS);
        expect(fin.getTime() - inicio.getTime() + 1, d).toBe(UN_DIA_MS);
        expect(fin.getTime() + 1, d).toBe(inicioDelDia(sumarDias(d, 1), ZONA_ARGENTINA).getTime());
      }),
      { numRuns: 1000 },
    );
  });

  it("propiedad: ida y vuelta — el inicio y el fin del día, leídos en la zona, son de ESE día; el instante anterior al inicio es del día anterior y el siguiente al fin, del día siguiente", () => {
    fc.assert(
      fc.property(diaReal, (d) => {
        const inicio = inicioDelDia(d, ZONA_ARGENTINA).getTime();
        const fin = finDelDia(d, ZONA_ARGENTINA).getTime();
        expect(diaDeCalendario(new Date(inicio), ZONA_ARGENTINA), d).toBe(d);
        expect(diaDeCalendario(new Date(fin), ZONA_ARGENTINA), d).toBe(d);
        expect(diaDeCalendario(new Date(inicio - 1), ZONA_ARGENTINA), d).toBe(sumarDias(d, -1));
        expect(diaDeCalendario(new Date(fin + 1), ZONA_ARGENTINA), d).toBe(sumarDias(d, 1));
      }),
      { numRuns: 1000 },
    );
  });

  it("propiedad: cualquier instante cae en el día que sale de restarle 3 horas y leerlo en UTC (la medianoche argentina es las 03:00 UTC)", () => {
    fc.assert(
      fc.property(fc.integer({ min: Date.UTC(2010, 0, 1), max: Date.UTC(2060, 11, 31) }), (ms) => {
        expect(diaDeCalendario(new Date(ms), ZONA_ARGENTINA), String(ms)).toBe(new Date(ms - TRES_HORAS_MS).toISOString().slice(0, 10));
      }),
      { numRuns: 2000 },
    );
  });

  it("los bordes de siempre, con un día cualquiera: 02:59:59.999 UTC es del día anterior y 03:00:00.000 UTC es del día (una venta de las 23:59 argentinas no se corre al día siguiente)", () => {
    fc.assert(
      fc.property(diaReal, (d) => {
        const medianocheUtc = fechaDeColumnaDate(d).getTime();
        expect(diaDeCalendario(new Date(medianocheUtc + TRES_HORAS_MS - 1), ZONA_ARGENTINA), d).toBe(sumarDias(d, -1));
        expect(diaDeCalendario(new Date(medianocheUtc + TRES_HORAS_MS), ZONA_ARGENTINA), d).toBe(d);
        // 23:59:59.999 argentinas = 02:59:59.999 UTC del día siguiente: sigue siendo del día.
        expect(diaDeCalendario(new Date(medianocheUtc + UN_DIA_MS + TRES_HORAS_MS - 1), ZONA_ARGENTINA), d).toBe(d);
      }),
      { numRuns: 500 },
    );
  });

  it("propiedad: rangoDeDias con las fechas «de solo día» de la URL (medianoche UTC) es [inicio del desde, fin del hasta] en la zona, y un rango al derecho nunca queda al revés", () => {
    fc.assert(
      fc.property(diaReal, fc.integer({ min: 0, max: 400 }), (desde, n) => {
        const hasta = sumarDias(desde, n);
        const r = rangoDeDias(fechaDeColumnaDate(desde), fechaDeColumnaDate(hasta), ZONA_ARGENTINA);
        expect(r.desde.getTime(), desde).toBe(inicioDelDia(desde, ZONA_ARGENTINA).getTime());
        expect(r.hasta.getTime(), hasta).toBe(finDelDia(hasta, ZONA_ARGENTINA).getTime());
        expect(r.hasta.getTime() - r.desde.getTime() + 1, `${desde}..${hasta}`).toBe((n + 1) * UN_DIA_MS);
      }),
      { numRuns: 500 },
    );
  });
});

describe("aritmética de calendario", () => {
  it("propiedad: sumar n días y restarlos vuelve al mismo día; siete días después es el mismo día de la semana; el día siguiente cambia el día de la semana", () => {
    fc.assert(
      fc.property(diaReal, fc.integer({ min: -3000, max: 3000 }), (d, n) => {
        expect(sumarDias(sumarDias(d, n), -n), `${d} ${n}`).toBe(d);
        expect(esDiaISOReal(sumarDias(d, n)), `${d} ${n}`).toBe(true);
        expect(diaDeLaSemana(sumarDias(d, 7)), d).toBe(diaDeLaSemana(d));
        expect(diaDeLaSemana(sumarDias(d, 1)), d).toBe((diaDeLaSemana(d) + 1) % 7);
      }),
      { numRuns: 1000 },
    );
  });
});
