import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SECRETO_DE_PRISMA = "Invalid `prisma.cotizacionDolar.upsert()` invocation: connect ECONNREFUSED postgres://motor2_app:clave-que-no-sale@db.interna:5432/motor2";
const resultadoDelCaso = vi.hoisted(() => ({ valor: null as unknown }));
const reportarError = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../../src/lib/reportar-error", () => ({ reportarError, reportarErrorUnaVez: vi.fn(async () => {}) }));
vi.mock("../../src/core/auth/base", () => ({ baseDelContexto: () => ({ db: {} }) }));
vi.mock("../../src/server/actions/reportes/sincronizaciones", () => ({ sincronizarDolar: async () => resultadoDelCaso.valor }));

import { GET } from "../../src/app/api/cron/sincronizar-dolar/route";
import { codigosDeErroresDeSincronizacion } from "../../src/core/reportes/public";

/**
 * M-27 (T16, segunda parte): el cron del dólar devolvía `resultado.errores` CRUDOS en el cuerpo del 200 (S-15 ya sacó el mensaje del 502, pero no este camino): entre esos errores va el
 * `message` de la excepción de Prisma al guardar un día del historial, con su consulta y hasta la cadena de conexión. Hacia afuera salen solo códigos fijos; el detalle completo sigue yendo
 * a Sentry (`reportarError`).
 */
describe("cron del dólar: la respuesta 200 no lleva el texto de los errores", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "secreto-del-cron-de-prueba";
    reportarError.mockClear();
  });
  afterEach(() => {
    delete process.env.CRON_SECRET;
  });
  const pedido = () => new Request("http://localhost/api/cron/sincronizar-dolar", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });

  it("EL ATAQUE: un día del historial que falló al guardarse (error de Prisma con la cadena de conexión) NO viaja en el cuerpo; sí un código, y el detalle va a Sentry", async () => {
    resultadoDelCaso.valor = {
      diasRellenados: 2,
      hoy: { fecha: "2026-09-18", compra: 1485, venta: 1535, fuente: "BNA" },
      fuente: "BNA",
      errores: [`historial: ${SECRETO_DE_PRISMA}`, "dolarapi.com: fetch failed https://dolarapi.com/v1/dolares/oficial", "historial 2026-09-17: cotización descartada: 2750 se aparta más de 20% de la última guardada (1530) y no la confirma otra fuente"],
    };
    const respuesta = await GET(pedido());
    expect(respuesta.status).toBe(200);
    const cuerpo = await respuesta.text();
    for (const filtrado of ["clave-que-no-sale", "ECONNREFUSED", "postgres://", "prisma.cotizacionDolar", "fetch failed", "dolarapi.com/v1", "2750"]) expect(cuerpo).not.toContain(filtrado);
    expect(JSON.parse(cuerpo)).toMatchObject({ diasRellenados: 2, fuente: "BNA", errores: ["historial", "dolarapi", "cotizacion-descartada"] });
    // el detalle completo sigue yendo a Sentry
    expect(String((reportarError.mock.calls[0] as unknown[])[0])).toContain("clave-que-no-sale");
  });

  it("una corrida sin errores sigue devolviendo la lista vacía", async () => {
    resultadoDelCaso.valor = { diasRellenados: 0, hoy: null, fuente: null, errores: [] };
    expect(await (await GET(pedido())).json()).toMatchObject({ errores: [] });
    expect(reportarError).not.toHaveBeenCalled();
  });
});

describe("codigosDeErroresDeSincronizacion", () => {
  it("clasifica cada error por su origen, sin repetir y en orden", () => {
    expect(
      codigosDeErroresDeSincronizacion([
        "historial: cualquier cosa",
        "historial 2026-09-01: cotización descartada: 1 se aparta",
        "historial: otra vez",
        "dolarapi.com no trajo una cotización válida",
        "BCRA: timeout",
        "BCRA no trajo una cotización válida",
        "algo inesperado",
        "cotización descartada: 15000 se aparta",
      ]),
    ).toEqual(["historial", "cotizacion-descartada", "dolarapi", "bcra", "otro"]);
    expect(codigosDeErroresDeSincronizacion([])).toEqual([]);
  });

  it("los códigos son fijos: nada del texto original sobrevive", () => {
    const salida = JSON.stringify(codigosDeErroresDeSincronizacion([`historial: ${SECRETO_DE_PRISMA}`, `BCRA: ${SECRETO_DE_PRISMA}`, SECRETO_DE_PRISMA]));
    expect(salida).not.toContain("clave-que-no-sale");
    expect(salida).toBe('["historial","bcra","otro"]');
  });
});
