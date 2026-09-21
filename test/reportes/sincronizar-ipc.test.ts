import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// El aviso a Sentry se cuenta, no se manda: el cron lo pide con `reportarErrorUnaVez` (ver route.ts).
const reportarErrorUnaVez = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../../src/lib/reportar-error", () => ({ reportarErrorUnaVez, reportarError: vi.fn(async () => {}) }));

import { limpiarBaseDeTest, prisma } from "../setup/test-db";
import { sincronizarIPC } from "../../src/core/reportes/indices-economicos";
import { GET } from "../../src/app/api/cron/sincronizar-ipc/route";

/**
 * 5c — el cron del IPC. `sincronizarIPC` devuelve la antigüedad de la serie GUARDADA (releída de la base) y el route handler avisa cuando
 * está vencida. Sin esto, un cron que responde 200 con `mesesNuevos: 0` todos los días durante meses es indistinguible de uno sano
 * (mismo síntoma que el del dólar, que no dejó ninguna fila y nadie se enteró). Fechas relativas a hoy, nunca literales.
 */
const ahora = new Date();
/** "YYYY-MM-01" del mes que queda `atras` meses antes del actual, como lo devuelve la API de series de tiempo. */
const mesApi = (atras: number) => new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth() - atras, 1)).toISOString().slice(0, 10);

function simularApi(mesesAtras: number[]) {
  vi.stubGlobal("fetch", async () => ({ ok: true, status: 200, json: async () => ({ data: mesesAtras.map((n, i) => [mesApi(n), 100 + i * 2]) }) }));
}

describe("sincronizarIPC — antigüedad de la serie guardada", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
    reportarErrorUnaVez.mockClear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.CRON_SECRET;
  });

  it("la API trae solo meses viejos: la serie guardada queda VENCIDA", async () => {
    simularApi([12, 11, 10]);
    const r = await sincronizarIPC(prisma);

    expect(r.mesesNuevos).toBe(3);
    expect(r.antiguedad.estado).toBe("vencida");
    expect(r.antiguedad.ultimoMes).toBe(mesApi(10).slice(0, 7));
  });

  it("la API trae el mes anterior (rezago normal): al día", async () => {
    simularApi([3, 2, 1]);
    const r = await sincronizarIPC(prisma);

    expect(r.antiguedad.estado).toBe("al-dia");
    expect(r.antiguedad.ultimoMes).toBe(mesApi(1).slice(0, 7));
  });

  it("el caso que nadie ve: la API no trae nada nuevo, mesesNuevos es 0 y la serie guardada SIGUE vencida", async () => {
    simularApi([12, 11, 10]);
    await sincronizarIPC(prisma); // primera corrida: carga los meses viejos
    simularApi([]); // el cron de todos los días: la API no trae nada (caída parcial, serie vacía…)
    const segunda = await sincronizarIPC(prisma);

    expect(segunda.mesesNuevos).toBe(0);
    expect(segunda.ultimoMesDisponible, "la API no dijo nada").toBeNull();
    expect(segunda.antiguedad.estado, "la antigüedad sale de lo GUARDADO, no de lo que dice la API").toBe("vencida");
  });
});

describe("cron del IPC — aviso cuando la serie queda vencida", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
    reportarErrorUnaVez.mockClear();
    process.env.CRON_SECRET = "secreto-de-prueba";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.CRON_SECRET;
  });

  const llamar = () => GET(new Request("http://localhost/api/cron/sincronizar-ipc", { headers: { authorization: "Bearer secreto-de-prueba" } }));

  it("serie vencida: responde 200 igual (la corrida hizo lo que pudo) y AVISA, con desde cuándo y cuántos días", async () => {
    simularApi([12, 11, 10]);
    const resp = await llamar();

    expect(resp.status).toBe(200);
    expect((await resp.json()).antiguedad.estado).toBe("vencida");
    expect(reportarErrorUnaVez).toHaveBeenCalledTimes(1);
    const [clave, error, area] = reportarErrorUnaVez.mock.calls[0] as unknown as [string, Error, string];
    expect(clave).toBe("ipc-serie-vencida");
    expect(area).toBe("ipc-cron");
    expect(error.message).toContain(mesApi(10).slice(0, 7));
    expect(error.message).toContain("no se actualiza desde");
  });

  it("serie al día: no avisa nada", async () => {
    simularApi([3, 2, 1]);
    const resp = await llamar();

    expect(resp.status).toBe(200);
    expect(reportarErrorUnaVez).not.toHaveBeenCalled();
  });
});
