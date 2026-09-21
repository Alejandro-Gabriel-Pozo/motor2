import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { calcularEsperaBackoffMs, conReintento } from "../../src/core/movimientos/reintentar";
import { esConflictoDeEscritura } from "../../src/core/movimientos/con-reintento";

// No necesitan Postgres: el ciclo de reintento (`conReintento`) y el
// reconocimiento del error (`esConflictoDeEscritura`) se prueban con errores
// sintéticos, sin abrir ninguna transacción.

function conflictoP2034() {
  return new Prisma.PrismaClientKnownRequestError("Transaction failed due to a write conflict", { code: "P2034", clientVersion: "test" });
}

function conflictoDeAdapter(kind: string) {
  const e = new Error("driver adapter error") as Error & { cause?: unknown };
  e.name = "DriverAdapterError";
  e.cause = { kind };
  return e;
}

describe("conReintento — comportamiento del ciclo", () => {
  // `dormir` inyectado: estos casos prueban el CICLO, no el tiempo (eso está en el describe de abajo).
  const config = () => ({ maxIntentos: 5, esReintentable: esConflictoDeEscritura, alResolverPorReintento: vi.fn(), alAgotar: vi.fn(), dormir: async () => {} });

  it("un éxito al primer intento hace una sola llamada y no avisa nada", async () => {
    const c = config();
    const operacion = vi.fn(async () => "ok");
    await expect(conReintento(operacion, c)).resolves.toBe("ok");
    expect(operacion).toHaveBeenCalledTimes(1);
    expect(c.alResolverPorReintento).not.toHaveBeenCalled();
    expect(c.alAgotar).not.toHaveBeenCalled();
  });

  it("un conflicto seguido de un éxito hace 2 llamadas, devuelve el resultado y avisa que se resolvió por reintento", async () => {
    const c = config();
    const operacion = vi.fn().mockRejectedValueOnce(conflictoP2034()).mockResolvedValueOnce("ok");
    await expect(conReintento(operacion, c)).resolves.toBe("ok");
    expect(operacion).toHaveBeenCalledTimes(2);
    expect(c.alResolverPorReintento).toHaveBeenCalledWith({ intento: 1, maxIntentos: 5 });
    expect(c.alAgotar).not.toHaveBeenCalled();
  });

  it("un conflicto en TODOS los intentos hace maxIntentos llamadas y relanza el error original", async () => {
    const c = config();
    const error = conflictoP2034();
    const operacion = vi.fn().mockRejectedValue(error);
    await expect(conReintento(operacion, c)).rejects.toBe(error);
    expect(operacion).toHaveBeenCalledTimes(5);
    expect(c.alAgotar).toHaveBeenCalledTimes(1);
    expect(c.alResolverPorReintento).not.toHaveBeenCalled();
  });

  it("respeta un maxIntentos distinto del default", async () => {
    const operacion = vi.fn().mockRejectedValue(conflictoP2034());
    await expect(conReintento(operacion, { ...config(), maxIntentos: 3 })).rejects.toBeDefined();
    expect(operacion).toHaveBeenCalledTimes(3);
  });

  it("un error que NO es un conflicto se propaga en el acto: una llamada, sin avisos", async () => {
    const c = config();
    const error = new Error("la base se cayó");
    const operacion = vi.fn().mockRejectedValue(error);
    await expect(conReintento(operacion, c)).rejects.toBe(error);
    expect(operacion).toHaveBeenCalledTimes(1);
    expect(c.alAgotar).not.toHaveBeenCalled();
  });
});

describe("conReintento — backoff con jitter entre intentos", () => {
  /** Ejecuta el ciclo registrando cada espera en vez de esperar de verdad: sin temporizadores, sin depender del scheduler. */
  async function correr(operacion: () => Promise<unknown>, extra: Partial<Parameters<typeof conReintento>[1]> = {}) {
    const esperas: number[] = [];
    const resultado = await conReintento(operacion, {
      maxIntentos: 5,
      esReintentable: esConflictoDeEscritura,
      dormir: async (ms) => {
        esperas.push(ms);
      },
      ...extra,
    }).then(
      (valor) => ({ ok: true as const, valor }),
      (error) => ({ ok: false as const, error })
    );
    return { esperas, resultado };
  }

  it("el camino feliz no espera nada", async () => {
    const { esperas } = await correr(async () => "ok");
    expect(esperas).toEqual([]);
  });

  it("un conflicto seguido de un éxito espera UNA vez antes del reintento", async () => {
    const operacion = vi.fn().mockRejectedValueOnce(conflictoP2034()).mockResolvedValueOnce("ok");
    const { esperas, resultado } = await correr(operacion);
    expect(esperas).toHaveLength(1);
    expect(resultado).toEqual({ ok: true, valor: "ok" });
  });

  it("la espera CRECE: con jitter máximo, 25, 50, 100 y 200 ms entre los 5 intentos", async () => {
    const { esperas } = await correr(vi.fn().mockRejectedValue(conflictoP2034()), { aleatorio: () => 1 });
    expect(esperas).toEqual([25, 50, 100, 200]);
  });

  it("el tope se respeta: con tope de 100 ms, 25, 50, 100 y 100", async () => {
    const { esperas } = await correr(vi.fn().mockRejectedValue(conflictoP2034()), { aleatorio: () => 1, topeEsperaMs: 100 });
    expect(esperas).toEqual([25, 50, 100, 100]);
  });

  it("hay jitter de verdad: la espera es una fracción aleatoria del techo", async () => {
    const conCero = await correr(vi.fn().mockRejectedValue(conflictoP2034()), { aleatorio: () => 0 });
    expect(conCero.esperas).toEqual([0, 0, 0, 0]);
    const conMitad = await correr(vi.fn().mockRejectedValue(conflictoP2034()), { aleatorio: () => 0.5 });
    expect(conMitad.esperas).toEqual([12.5, 25, 50, 100]);
  });

  it("con el aleatorio real, cada espera queda entre 0 y su techo", async () => {
    const techos = [25, 50, 100, 200];
    for (let i = 0; i < 20; i++) {
      const { esperas } = await correr(vi.fn().mockRejectedValue(conflictoP2034()));
      esperas.forEach((ms, k) => {
        expect(ms).toBeGreaterThanOrEqual(0);
        expect(ms).toBeLessThanOrEqual(techos[k]);
      });
    }
  });

  it("no espera de más: nunca hay una espera después del último intento fallido", async () => {
    for (const maxIntentos of [1, 2, 3, 5]) {
      const { esperas } = await correr(vi.fn().mockRejectedValue(conflictoP2034()), { maxIntentos });
      expect(esperas).toHaveLength(maxIntentos - 1);
    }
  });

  it("un error que NO es un conflicto no espera ni reintenta", async () => {
    const operacion = vi.fn().mockRejectedValue(new Error("la base se cayó"));
    const { esperas } = await correr(operacion);
    expect(esperas).toEqual([]);
    expect(operacion).toHaveBeenCalledTimes(1);
  });

  it("calcularEsperaBackoffMs: techo = min(tope, base * 2^intento), multiplicado por el aleatorio", () => {
    const techo = (intento: number) => calcularEsperaBackoffMs(intento, { aleatorio: () => 1 });
    expect([0, 1, 2, 3, 4, 5, 10].map(techo)).toEqual([25, 50, 100, 200, 250, 250, 250]);
    expect(calcularEsperaBackoffMs(2, { baseMs: 10, topeMs: 1000, aleatorio: () => 0.5 })).toBe(20);
  });
});

describe("esConflictoDeEscritura — qué errores cuentan como conflicto", () => {
  it("reconoce el P2034 de Prisma", () => {
    expect(esConflictoDeEscritura(conflictoP2034())).toBe(true);
  });

  it("reconoce el DriverAdapterError de un conflicto de escritura (SQLSTATE 40001/40P01)", () => {
    expect(esConflictoDeEscritura(conflictoDeAdapter("TransactionWriteConflict"))).toBe(true);
  });

  it("NO reconoce otro DriverAdapterError (una conexión caída no es un conflicto y no se reintenta)", () => {
    expect(esConflictoDeEscritura(conflictoDeAdapter("ConnectionClosed"))).toBe(false);
  });

  it("NO reconoce un choque de unicidad ni un error cualquiera", () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" });
    expect(esConflictoDeEscritura(p2002)).toBe(false);
    expect(esConflictoDeEscritura(new Error("otro"))).toBe(false);
    expect(esConflictoDeEscritura("no es un error")).toBe(false);
  });
});
