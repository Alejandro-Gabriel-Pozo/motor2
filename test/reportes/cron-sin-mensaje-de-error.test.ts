import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SECRETO_EN_EL_ERROR = "connect ECONNREFUSED postgres://motor2_app:clave-que-no-sale@db.interna:5432/motor2";
const reportarError = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../../src/lib/reportar-error", () => ({ reportarError, reportarErrorUnaVez: vi.fn(async () => {}) }));
vi.mock("../../src/core/auth/base", () => ({ baseDelContexto: () => ({ db: {} }) }));
vi.mock("../../src/server/actions/reportes/sincronizaciones", () => ({
  sincronizarDolar: async () => {
    throw new Error(SECRETO_EN_EL_ERROR);
  },
  sincronizarIPC: async () => {
    throw new Error(SECRETO_EN_EL_ERROR);
  },
}));

import { GET as cronDolar } from "../../src/app/api/cron/sincronizar-dolar/route";
import { GET as cronIpc } from "../../src/app/api/cron/sincronizar-ipc/route";

/**
 * S-15 (plan de endurecimiento de seguridad, tanda T7; B-A19 del informe B): los dos crons devolvían `e.message` en el cuerpo de la respuesta HTTP. Un error de la base, de la red o de
 * una librería trae texto interno (hosts, cadenas de conexión, rutas). Quien llama es Vercel Cron con el secreto, pero un cuerpo de error es lo que termina en logs, paneles y capturas:
 * el detalle va a Sentry (`reportarError`, donde sí hace falta) y la respuesta dice solo que falló.
 */
describe("S-15: los crons no devuelven el mensaje del error", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "secreto-del-cron-de-prueba";
    reportarError.mockClear();
  });
  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  const pedido = () => new Request("http://localhost/api/cron/x", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });

  for (const [nombre, GET] of [
    ["sincronizar-dolar", cronDolar],
    ["sincronizar-ipc", cronIpc],
  ] as const) {
    it(`EL ATAQUE: ${nombre} responde 502 sin el texto del error (antes: el message completo), y el detalle va a Sentry`, async () => {
      const respuesta = await GET(pedido());
      expect(respuesta.status).toBe(502);
      const cuerpo = await respuesta.text();
      expect(cuerpo).not.toContain("clave-que-no-sale");
      expect(cuerpo).not.toContain("ECONNREFUSED");
      expect(reportarError).toHaveBeenCalledTimes(1);
      expect(String((reportarError.mock.calls[0] as unknown[])[0])).toContain("clave-que-no-sale");
    });
  }

  it("sin el secreto correcto sigue siendo 401", async () => {
    expect((await cronDolar(new Request("http://localhost/api/cron/x"))).status).toBe(401);
  });
});
