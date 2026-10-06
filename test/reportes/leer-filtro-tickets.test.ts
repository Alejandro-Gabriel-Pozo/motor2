import { describe, expect, it } from "vitest";
import { leerFiltroTickets, serializarFiltroTickets } from "../../src/core/reportes/tickets-emitidos";
import { ZONA_ARGENTINA } from "../../src/core/tiempo/zona-horaria";

/**
 * `leerFiltroTickets` (Task #17): sin parámetros de fecha en absoluto → default «hoy» en Argentina; con el campo presente pero
 * vacío (el form se mandó con las fechas en blanco) → sin límite para ese lado. Puro, sin Postgres.
 */
describe("leerFiltroTickets", () => {
  const ahora = new Date("2026-09-26T01:00:00.000Z"); // 22:00 ART del 25/09

  it("sin ningún parámetro de fecha: default «hoy» en Argentina (no en UTC)", () => {
    const { desde, hasta, filtro } = leerFiltroTickets({}, ZONA_ARGENTINA, ahora);
    expect(desde).toBe("2026-09-25");
    expect(hasta).toBe("2026-09-25");
    expect(filtro.desde?.toISOString()).toBe("2026-09-25T03:00:00.000Z");
    expect(filtro.hasta?.toISOString()).toBe("2026-09-26T02:59:59.999Z");
  });

  it("con otra zona (Nueva York, UTC-4 en septiembre) el «hoy» y los límites del día son los de esa zona", () => {
    // 01:00 UTC del 26/09 son las 21:00 del 25/09 en Nueva York (y las 22:00 del 25/09 en Buenos Aires).
    const { desde, hasta, filtro } = leerFiltroTickets({}, "America/New_York", ahora);
    expect(desde).toBe("2026-09-25");
    expect(hasta).toBe("2026-09-25");
    expect(filtro.desde?.toISOString()).toBe("2026-09-25T04:00:00.000Z");
    expect(filtro.hasta?.toISOString()).toBe("2026-09-26T03:59:59.999Z");
  });

  it("con los dos campos presentes pero VACÍOS (\"vaciar fechas\"): sin límite en ninguno de los dos lados", () => {
    const { desde, hasta, filtro } = leerFiltroTickets({ desde: "", hasta: "" }, ZONA_ARGENTINA, ahora);
    expect(desde).toBe("");
    expect(hasta).toBe("");
    expect(filtro.desde).toBeUndefined();
    expect(filtro.hasta).toBeUndefined();
  });

  it("con un valor explícito se usa tal cual, sin aplicar el default de «hoy»", () => {
    const { desde, hasta, filtro } = leerFiltroTickets({ desde: "2026-08-01", hasta: "2026-08-31" }, ZONA_ARGENTINA, ahora);
    expect(desde).toBe("2026-08-01");
    expect(hasta).toBe("2026-08-31");
    expect(filtro.desde?.toISOString()).toBe("2026-08-01T03:00:00.000Z");
    expect(filtro.hasta?.toISOString()).toBe("2026-09-01T02:59:59.999Z");
  });

  it("solo un campo presente (el otro ausente) NO cuenta como «sin parámetros»: no se aplica el default en ninguno", () => {
    const { desde, hasta } = leerFiltroTickets({ desde: "2026-08-01" }, ZONA_ARGENTINA, ahora);
    expect(desde).toBe("2026-08-01");
    expect(hasta).toBe("");
  });

  it("una fecha inválida se descarta, como si viniera vacía", () => {
    const { desde, filtro } = leerFiltroTickets({ desde: "no-es-una-fecha", hasta: "" }, ZONA_ARGENTINA, ahora);
    expect(desde).toBe("");
    expect(filtro.desde).toBeUndefined();
  });

  it("mesaId y cursor pasan derecho al filtro", () => {
    const { mesaId, filtro } = leerFiltroTickets({ desde: "", hasta: "", mesaId: "mesa1", cursor: "c1" }, ZONA_ARGENTINA, ahora);
    expect(mesaId).toBe("mesa1");
    expect(filtro).toMatchObject({ mesaId: "mesa1", cursor: "c1" });
  });
});

describe("serializarFiltroTickets", () => {
  it("siempre incluye desde y hasta explícitos (aunque estén vacíos), para que «Página siguiente» nunca reaplique el default de «hoy»", () => {
    const params = serializarFiltroTickets({ desde: "", hasta: "", cursor: "c1" });
    expect(params.get("desde")).toBe("");
    expect(params.get("hasta")).toBe("");
    expect(params.get("cursor")).toBe("c1");
  });

  it("mesaId y cursor son opcionales: sin ellos, no aparecen en el querystring", () => {
    const params = serializarFiltroTickets({ desde: "2026-08-01", hasta: "2026-08-31" });
    expect(params.toString()).toBe("desde=2026-08-01&hasta=2026-08-31");
  });
});
