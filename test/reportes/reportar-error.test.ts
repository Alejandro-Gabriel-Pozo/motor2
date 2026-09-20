import { describe, expect, it, vi } from "vitest";

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn(), flush: vi.fn(async () => true) }));
import * as Sentry from "@sentry/nextjs";
import { reportarError, reportarErrorUnaVez } from "../../src/lib/reportar-error";

/** Reportar a Sentry nunca puede romper a quien reporta, y las condiciones que se repiten en cada pedido se avisan una sola vez. */
describe("reportarError", () => {
  it("captura el error con su etiqueta y espera a que salga (corre dentro de after() y de crons)", async () => {
    const error = new Error("falló");
    await reportarError(error, "dolar-cron");
    expect(Sentry.captureException).toHaveBeenCalledWith(error, { tags: { area: "dolar-cron" } });
    expect(Sentry.flush).toHaveBeenCalledWith(2000);
  });

  it("si Sentry falla, no lanza", async () => {
    vi.mocked(Sentry.captureException).mockImplementationOnce(() => {
      throw new Error("Sentry caído");
    });
    await expect(reportarError(new Error("x"), "area")).resolves.toBeUndefined();
  });

  it("reportarErrorUnaVez avisa una sola vez por clave, aunque se llame en cada pedido", async () => {
    vi.mocked(Sentry.captureException).mockClear();
    for (let i = 0; i < 5; i++) await reportarErrorUnaVez("sin-secreto", new Error("CRON_SECRET no está configurada"), "dolar-cron");
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    await reportarErrorUnaVez("otra-clave", new Error("otro"), "ipc-cron");
    expect(Sentry.captureException).toHaveBeenCalledTimes(2);
  });
});
