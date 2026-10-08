import { Prisma } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { conTransaccionSerializable } from "../../src/core/movimientos/public-servidor";
import type { Transaccion } from "../../src/lib/db-tipos";

/**
 * El CONTRATO de `conTransaccionSerializable` (Hito 5, pieza 5.3, paso 5.3-0 de `docs/plan-hito-5-pureza.md`): la red de la mudanza que la saca de `core/movimientos/con-reintento.ts` a
 * `src/lib/transaccion-serializable.ts`. Sin base: transacciones falsas que cuentan intentos, fallan con lo que se les diga y recuerdan las opciones con que las abrieron. Fija, tal cual hoy:
 *  - las opciones de la transacción: `{ isolationLevel: "Serializable", maxWait: 5000, timeout: 15000 }`;
 *  - 5 intentos por defecto (4 conflictos se resuelven; 5 lanzan el ÚLTIMO error);
 *  - un choque de índice único (P2002) NO se reintenta salvo `tambienChoqueDeUnico`;
 *  - un error ajeno se propaga en el acto, sin dormir;
 *  - los dos logs (`console.log` al resolver por reintento, `console.error` al agotar) con sus campos.
 * Se importa por la fachada de servidor de `movimientos` (el lugar viejo); el paso 5.3-1 reapunta ESTE import a `@/lib/transaccion-serializable` sin tocar ninguna aserción.
 */
const conflicto = (id = "") => new Prisma.PrismaClientKnownRequestError(`write conflict ${id}`.trim(), { code: "P2034", clientVersion: "7.10.0" });
const p2002 = () => new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "7.10.0" });

/** Una transacción falsa: cada llamada consume el siguiente fallo (`undefined` = tiene éxito) y anota las opciones con que la abrieron. */
function transaccionFalsa(fallos: unknown[]) {
  const opciones: unknown[] = [];
  const tx = {} as Prisma.TransactionClient;
  let intentos = 0;
  const transaccion = (async (fn: (tx: Prisma.TransactionClient) => Promise<unknown>, opts?: unknown) => {
    opciones.push(opts);
    const fallo = fallos[intentos++];
    if (fallo !== undefined) throw fallo;
    return fn(tx);
  }) as unknown as Transaccion;
  return { transaccion, tx, opciones, intentos: () => intentos };
}

/** La espera entre intentos: determinista (azar fijo en 0,2 → 5, 10, 20, 40 ms) y sin temporizadores; guarda cuánto se pidió dormir. */
function esperaFija() {
  const dormidas: number[] = [];
  return { dormidas, opciones: { aleatorio: () => 0.2, dormir: async (ms: number) => void dormidas.push(ms) } };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("conTransaccionSerializable: la transacción", () => {
  it("abre la transacción SERIALIZABLE con maxWait 5000 y timeout 15000, y le pasa el cliente de la transacción a la función", async () => {
    const { transaccion, tx, opciones } = transaccionFalsa([]);
    const fn = vi.fn(async (cliente: Prisma.TransactionClient) => (cliente === tx ? "el cliente de la transacción" : "otro"));
    const r = await conTransaccionSerializable(transaccion, fn);
    expect(r).toBe("el cliente de la transacción");
    expect(opciones).toEqual([{ isolationLevel: "Serializable", maxWait: 5_000, timeout: 15_000 }]);
  });

  it("las opciones son las mismas en cada reintento", async () => {
    const { transaccion, opciones } = transaccionFalsa([conflicto(), conflicto()]);
    await conTransaccionSerializable(transaccion, async () => "ok", 5, esperaFija().opciones);
    expect(opciones).toEqual(Array(3).fill({ isolationLevel: "Serializable", maxWait: 5_000, timeout: 15_000 }));
  });

  it("un éxito al primer intento hace una sola llamada, no duerme y no escribe ningún log", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { transaccion, intentos } = transaccionFalsa([]);
    const e = esperaFija();
    expect(await conTransaccionSerializable(transaccion, async () => 42, 5, e.opciones)).toBe(42);
    expect(intentos()).toBe(1);
    expect(e.dormidas).toEqual([]);
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});

describe("conTransaccionSerializable: cuántos intentos", () => {
  it("por defecto son 5: 4 conflictos seguidos se resuelven al quinto intento", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { transaccion, intentos } = transaccionFalsa([conflicto("1"), conflicto("2"), conflicto("3"), conflicto("4")]);
    const e = esperaFija();
    expect(await conTransaccionSerializable(transaccion, async () => "ok", undefined, e.opciones)).toBe("ok");
    expect(intentos()).toBe(5);
    // Se duerme ENTRE intentos: 4 esperas, con jitter completo (0,2 × 25, 50, 100, 200).
    expect(e.dormidas).toEqual([5, 10, 20, 40]);
  });

  it("por defecto, 5 conflictos agotan los intentos y se lanza el ÚLTIMO error, sin dormir después del último", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const errores = [1, 2, 3, 4, 5].map((n) => conflicto(String(n)));
    const { transaccion, intentos } = transaccionFalsa(errores);
    const e = esperaFija();
    await expect(conTransaccionSerializable(transaccion, async () => "ok", undefined, e.opciones)).rejects.toBe(errores[4]);
    expect(intentos()).toBe(5);
    expect(e.dormidas).toEqual([5, 10, 20, 40]);
  });

  it("respeta un maxIntentos pedido", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { transaccion, intentos } = transaccionFalsa([conflicto(), conflicto(), conflicto(), conflicto()]);
    await expect(conTransaccionSerializable(transaccion, async () => "ok", 2, esperaFija().opciones)).rejects.toMatchObject({ code: "P2034" });
    expect(intentos()).toBe(2);
  });
});

describe("conTransaccionSerializable: qué se reintenta", () => {
  it("el DriverAdapterError crudo con TransactionWriteConflict también es un conflicto", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const crudo = Object.assign(new Error("conflicto en el commit"), { name: "DriverAdapterError", cause: { kind: "TransactionWriteConflict" } });
    const { transaccion, intentos } = transaccionFalsa([crudo]);
    expect(await conTransaccionSerializable(transaccion, async () => "ok", 5, esperaFija().opciones)).toBe("ok");
    expect(intentos()).toBe(2);
  });

  it("un choque de índice único (P2002) NO se reintenta por defecto: se propaga en el primer intento y sin dormir", async () => {
    const { transaccion, intentos } = transaccionFalsa([p2002()]);
    const e = esperaFija();
    await expect(conTransaccionSerializable(transaccion, async () => "ok", 5, e.opciones)).rejects.toMatchObject({ code: "P2002" });
    expect(intentos()).toBe(1);
    expect(e.dormidas).toEqual([]);
  });

  it("con tambienChoqueDeUnico, el P2002 se reintenta y la repetición devuelve el resultado", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { transaccion, intentos } = transaccionFalsa([p2002()]);
    expect(await conTransaccionSerializable(transaccion, async () => "ok", 5, esperaFija().opciones, true)).toBe("ok");
    expect(intentos()).toBe(2);
  });

  it("con tambienChoqueDeUnico, el conflicto de escritura sigue reintentándose", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { transaccion, intentos } = transaccionFalsa([conflicto(), p2002()]);
    expect(await conTransaccionSerializable(transaccion, async () => "ok", 5, esperaFija().opciones, true)).toBe("ok");
    expect(intentos()).toBe(3);
  });

  it("un error ajeno se propaga en el acto, sin dormir y sin ningún log, también con tambienChoqueDeUnico", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    for (const pedirChoque of [false, true]) {
      const ajeno = new Error("conexión caída");
      const { transaccion, intentos } = transaccionFalsa([ajeno]);
      const e = esperaFija();
      await expect(conTransaccionSerializable(transaccion, async () => "ok", 5, e.opciones, pedirChoque)).rejects.toBe(ajeno);
      expect(intentos()).toBe(1);
      expect(e.dormidas).toEqual([]);
    }
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("un error de la función del caso de uso (no de la transacción) que no es un conflicto tampoco se reintenta", async () => {
    const { transaccion, intentos } = transaccionFalsa([]);
    const negocio = new Error("regla de negocio");
    await expect(conTransaccionSerializable(transaccion, async () => Promise.reject(negocio), 5, esperaFija().opciones)).rejects.toBe(negocio);
    expect(intentos()).toBe(1);
  });
});

describe("conTransaccionSerializable: los logs de la investigación", () => {
  it("al resolver por reintento, console.log con intento, maxIntentos y la espera total redondeada", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { transaccion } = transaccionFalsa([conflicto(), conflicto()]);
    await conTransaccionSerializable(transaccion, async () => "ok", 7, esperaFija().opciones);
    expect(log).toHaveBeenCalledTimes(1);
    // Resolvió en el intento 2 (0 = el primero) tras esperar 5 + 10 ms.
    expect(log).toHaveBeenCalledWith("[con-reintento][investigacion] conflicto de escritura resuelto por reintento", { intento: 2, maxIntentos: 7, esperaTotalMs: 15 });
    expect(error).not.toHaveBeenCalled();
  });

  it("la espera total del log se redondea al milisegundo", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { transaccion } = transaccionFalsa([conflicto()]);
    // 0,3 × 25 = 7,5 ms → 8.
    await conTransaccionSerializable(transaccion, async () => "ok", 5, { aleatorio: () => 0.3, dormir: async () => undefined });
    expect(log).toHaveBeenCalledWith(expect.any(String), { intento: 1, maxIntentos: 5, esperaTotalMs: 8 });
  });

  it("al agotar los intentos, console.error con maxIntentos, la espera total y el código del error de la base", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { transaccion } = transaccionFalsa([conflicto(), conflicto(), conflicto()]);
    await expect(conTransaccionSerializable(transaccion, async () => "ok", 3, esperaFija().opciones)).rejects.toMatchObject({ code: "P2034" });
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith("[con-reintento][investigacion] conflicto de escritura agotó los reintentos", { maxIntentos: 3, esperaTotalMs: 15, code: "P2034" });
    expect(log).not.toHaveBeenCalled();
  });

  it("si lo que agota los intentos no es un error conocido de Prisma, el código del log es undefined", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const crudo = Object.assign(new Error("conflicto en el commit"), { name: "DriverAdapterError", cause: { kind: "TransactionWriteConflict" } });
    const { transaccion } = transaccionFalsa([crudo, crudo]);
    await expect(conTransaccionSerializable(transaccion, async () => "ok", 2, esperaFija().opciones)).rejects.toBe(crudo);
    expect(error).toHaveBeenCalledWith(expect.any(String), { maxIntentos: 2, esperaTotalMs: 5, code: undefined });
  });
});
