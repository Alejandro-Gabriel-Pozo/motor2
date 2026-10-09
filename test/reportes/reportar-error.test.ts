import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn(), flush: vi.fn(async () => true) }));
import * as Sentry from "@sentry/nextjs";
import { reportarError, reportarErrorUnaVez, resumenDeErrorParaElLog } from "../../src/lib/reportar-error";

/**
 * M-27 (T16): sin Sentry configurado los crons y los fallos atrapados quedaban SIN RASTRO (`reportarError` no hacía nada). Ahora dejan una línea de `console.error` con un resumen (área y tipo
 * del error), jamás el mensaje crudo (ids, hosts, cadenas de conexión, datos).
 */
describe("reportarError sin Sentry configurado (M-27)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("EL DEFECTO: sin DSN deja un rastro en la consola con el área y el tipo, y NUNCA el mensaje del error", async () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "");
    const consola = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = Object.assign(new Error("connect ECONNREFUSED postgres://motor2_app:clave-que-no-sale@db.interna/motor2 id=cl8x9abc"), { name: "PrismaClientKnownRequestError", code: "P2002" });
    await reportarError(error, "dolar-cron");
    expect(consola).toHaveBeenCalledTimes(1);
    const linea = String(consola.mock.calls[0]![0]);
    expect(linea).toBe("[error] area=dolar-cron tipo=PrismaClientKnownRequestError codigo=P2002");
    expect(JSON.stringify(consola.mock.calls)).not.toMatch(/clave-que-no-sale|ECONNREFUSED|cl8x9abc/);
  });

  it("con Sentry configurado no escribe en la consola (el evento sale por Sentry)", async () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "https://clave@o0.ingest.sentry.io/1");
    const consola = vi.spyOn(console, "error").mockImplementation(() => {});
    await reportarError(new Error("x"), "dolar-cron");
    expect(consola).not.toHaveBeenCalled();
  });

  it("también deja rastro para lo que no es un Error (un string, null) y reportarErrorUnaVez lo deja una sola vez", async () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "");
    const consola = vi.spyOn(console, "error").mockImplementation(() => {});
    await reportarError("texto suelto con datos@x.com", "ipc-cron");
    await reportarError(null, "ipc-cron");
    expect(consola.mock.calls.map((c) => String(c[0]))).toEqual(["[error] area=ipc-cron tipo=string", "[error] area=ipc-cron tipo=object"]);
    consola.mockClear();
    for (let i = 0; i < 3; i++) await reportarErrorUnaVez("m27-sin-secreto", new Error("CRON_SECRET no está configurada"), "dolar-cron");
    expect(consola).toHaveBeenCalledTimes(1);
  });

  it("el resumen acota el nombre y el área a caracteres seguros y solo copia códigos de la base", () => {
    const raro = Object.assign(new Error("m"), { name: "Error con\nsalto y datos@x.com", code: "ECONNREFUSED" });
    expect(resumenDeErrorParaElLog(raro, "area con espacios\n")).toBe("[error] area=area_con_espacios_ tipo=Error_con_salto_y_datos_x.com");
  });
});

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
