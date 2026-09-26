import { describe, expect, it } from "vitest";
import { leerFiltroBoletas, serializarFiltroBoletas } from "../../src/core/reportes/boletas-emitidas";

/**
 * `leerFiltroBoletas` (Task #17): sin parámetros de fecha en absoluto → default «hoy» en Argentina; con el campo presente pero
 * vacío (el form se mandó con las fechas en blanco) → sin límite para ese lado. Puro, sin Postgres.
 */
describe("leerFiltroBoletas", () => {
  const ahora = new Date("2026-09-26T01:00:00.000Z"); // 22:00 ART del 25/09

  it("sin ningún parámetro de fecha: default «hoy» en Argentina (no en UTC)", () => {
    const { desde, hasta, filtro } = leerFiltroBoletas({}, ahora);
    expect(desde).toBe("2026-09-25");
    expect(hasta).toBe("2026-09-25");
    expect(filtro.desde?.toISOString()).toBe("2026-09-25T03:00:00.000Z");
    expect(filtro.hasta?.toISOString()).toBe("2026-09-26T02:59:59.999Z");
  });

  it("con los dos campos presentes pero VACÍOS (\"vaciar fechas\"): sin límite en ninguno de los dos lados", () => {
    const { desde, hasta, filtro } = leerFiltroBoletas({ desde: "", hasta: "" }, ahora);
    expect(desde).toBe("");
    expect(hasta).toBe("");
    expect(filtro.desde).toBeUndefined();
    expect(filtro.hasta).toBeUndefined();
  });

  it("con un valor explícito se usa tal cual, sin aplicar el default de «hoy»", () => {
    const { desde, hasta, filtro } = leerFiltroBoletas({ desde: "2026-08-01", hasta: "2026-08-31" }, ahora);
    expect(desde).toBe("2026-08-01");
    expect(hasta).toBe("2026-08-31");
    expect(filtro.desde?.toISOString()).toBe("2026-08-01T03:00:00.000Z");
    expect(filtro.hasta?.toISOString()).toBe("2026-09-01T02:59:59.999Z");
  });

  it("solo un campo presente (el otro ausente) NO cuenta como «sin parámetros»: no se aplica el default en ninguno", () => {
    const { desde, hasta } = leerFiltroBoletas({ desde: "2026-08-01" }, ahora);
    expect(desde).toBe("2026-08-01");
    expect(hasta).toBe("");
  });

  it("una fecha inválida se descarta, como si viniera vacía", () => {
    const { desde, filtro } = leerFiltroBoletas({ desde: "no-es-una-fecha", hasta: "" }, ahora);
    expect(desde).toBe("");
    expect(filtro.desde).toBeUndefined();
  });

  it("mesaId y cursor pasan derecho al filtro", () => {
    const { mesaId, filtro } = leerFiltroBoletas({ desde: "", hasta: "", mesaId: "mesa1", cursor: "c1" }, ahora);
    expect(mesaId).toBe("mesa1");
    expect(filtro).toMatchObject({ mesaId: "mesa1", cursor: "c1" });
  });
});

describe("serializarFiltroBoletas", () => {
  it("siempre incluye desde y hasta explícitos (aunque estén vacíos), para que «Página siguiente» nunca reaplique el default de «hoy»", () => {
    const params = serializarFiltroBoletas({ desde: "", hasta: "", cursor: "c1" });
    expect(params.get("desde")).toBe("");
    expect(params.get("hasta")).toBe("");
    expect(params.get("cursor")).toBe("c1");
  });

  it("mesaId y cursor son opcionales: sin ellos, no aparecen en el querystring", () => {
    const params = serializarFiltroBoletas({ desde: "2026-08-01", hasta: "2026-08-31" });
    expect(params.toString()).toBe("desde=2026-08-01&hasta=2026-08-31");
  });
});
