import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { leerFiltroTickets } from "../../src/core/reportes/tickets-emitidos";
import { ZONA_ARGENTINA, ZONA_UTC, rangoDeDias, sumarDias } from "../../src/core/tiempo/zona-horaria";

/**
 * Un solo corte de día para Período y Tickets (P1, O.251). Período y su familia expanden el rango con `rangoDeDias(desde, hasta, zona)` y Tickets con `leerFiltroTickets(…, zona)`
 * (`inicioDelDia` / `finDelDia`): si los dos no dan los MISMOS límites para el mismo día y la misma zona, una venta cae en el día D en un reporte y en D+1 en el otro. Puro, sin Postgres;
 * el `ahora` de `leerFiltroTickets` no interviene cuando `desde`/`hasta` vienen explícitos, y se fija igual para que el test no dependa del reloj.
 */
const AHORA = new Date("2026-09-26T01:00:00.000Z");
/** Zonas de fuera de Argentina incluidas a propósito: Nueva York (horario de verano), Calcuta (media hora) y Sídney (adelante de UTC). */
const ZONAS = [ZONA_ARGENTINA, ZONA_UTC, "America/New_York", "Asia/Kolkata", "Australia/Sydney"];

/** Un día «AAAA-MM-DD» cualquiera entre 2019 y 2032 (incluye bisiestos y los cambios de horario de verano de las zonas de arriba). */
const dia = fc.integer({ min: 0, max: 365 * 13 }).map((n) => sumarDias("2019-01-01", n));
const zona = fc.constantFrom(...ZONAS);
/** Las fechas «de solo día» que llegan a la consulta: `new Date("AAAA-MM-DD")`, medianoche UTC. */
const comoLlegaALaConsulta = (d: string) => new Date(d);

describe("corte de días: Período (rangoDeDias) y Tickets (leerFiltroTickets) cortan igual", () => {
  it("propiedad: rangoDeDias(d, d, z) es exactamente [inicio, fin] del día que arma leerFiltroTickets({desde: d, hasta: d}, z)", () => {
    fc.assert(
      fc.property(dia, zona, (d, z) => {
        const r = rangoDeDias(comoLlegaALaConsulta(d), comoLlegaALaConsulta(d), z);
        const { filtro } = leerFiltroTickets({ desde: d, hasta: d }, z, AHORA);
        expect(r.desde.getTime()).toBe(filtro.desde!.getTime());
        expect(r.hasta.getTime()).toBe(filtro.hasta!.getTime());
      }),
      { numRuns: 500 }
    );
  });

  it("propiedad: también para un rango de varios días, y el límite de un día y el del siguiente no se pisan ni dejan hueco", () => {
    fc.assert(
      fc.property(dia, fc.integer({ min: 0, max: 60 }), zona, (d, largo, z) => {
        const e = sumarDias(d, largo);
        const r = rangoDeDias(comoLlegaALaConsulta(d), comoLlegaALaConsulta(e), z);
        const { filtro } = leerFiltroTickets({ desde: d, hasta: e }, z, AHORA);
        expect(r.desde.getTime()).toBe(filtro.desde!.getTime());
        expect(r.hasta.getTime()).toBe(filtro.hasta!.getTime());
        // Sin hueco ni solapamiento: el milisegundo siguiente al fin del día D es el inicio del día D+1.
        const finDeD = rangoDeDias(comoLlegaALaConsulta(d), comoLlegaALaConsulta(d), z).hasta;
        const inicioDeSiguiente = rangoDeDias(comoLlegaALaConsulta(sumarDias(d, 1)), comoLlegaALaConsulta(sumarDias(d, 1)), z).desde;
        expect(finDeD.getTime() + 1).toBe(inicioDeSiguiente.getTime());
      }),
      { numRuns: 300 }
    );
  });

  it("ejemplos argentinos fijos: el día va de 03:00Z a 02:59:59.999Z del día siguiente (borde de mes, de año y bisiesto)", () => {
    const casos: Array<[string, string, string]> = [
      ["2026-09-30", "2026-09-30T03:00:00.000Z", "2026-10-01T02:59:59.999Z"],
      ["2025-12-31", "2025-12-31T03:00:00.000Z", "2026-01-01T02:59:59.999Z"],
      ["2024-02-29", "2024-02-29T03:00:00.000Z", "2024-03-01T02:59:59.999Z"],
    ];
    for (const [d, inicio, fin] of casos) {
      const r = rangoDeDias(comoLlegaALaConsulta(d), comoLlegaALaConsulta(d), ZONA_ARGENTINA);
      expect(r.desde.toISOString()).toBe(inicio);
      expect(r.hasta.toISOString()).toBe(fin);
    }
  });

  it("la zona importa: con corte UTC el mismo día no es el mismo rango (el test de arriba no pasa de casualidad)", () => {
    const d = comoLlegaALaConsulta("2026-09-30");
    expect(rangoDeDias(d, d, ZONA_UTC).desde.getTime()).not.toBe(rangoDeDias(d, d, ZONA_ARGENTINA).desde.getTime());
  });
});
