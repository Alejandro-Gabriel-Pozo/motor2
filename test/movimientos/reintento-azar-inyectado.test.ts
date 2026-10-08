import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { conTransaccionSerializable } from "../../src/lib/transaccion-serializable";
import { calcularEsperaBackoffMs, conReintento } from "../../src/core/movimientos/reintentar";
import { numeroEnUnidad, type FuenteDeAzar } from "../../src/core/seguridad/azar";
import { baseDeEmpresa, baseDelContexto, transaccionDeLaEmpresa } from "../../src/core/auth/base";
import type { Transaccion } from "../../src/lib/db-tipos";

/**
 * El jitter del reintento (la espera entre dos intentos de una transacción SERIALIZABLE) usa una fuente de azar INYECTADA, nunca `Math.random` por defecto dentro del núcleo (Pureza 1.5;
 * la auditoría de la Fase 1 encontró `aleatorio = Math.random` en `reintentar.ts` porque el analizador solo veía llamadas). En producción la fuente la trae la transacción del borde
 * que la crea (`core/auth/base.ts`, `Transaccion.aleatorio`); sin ninguna, la espera es la MITAD del techo (determinista).
 */
const conflicto = () => new Prisma.PrismaClientKnownRequestError("write conflict", { code: "P2034", clientVersion: "7.10.0" });

function transaccionQueFalla(fallos: number, aleatorio?: () => number): Transaccion {
  let n = 0;
  const abrir = (async (fn: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
    if (n++ < fallos) throw conflicto();
    return fn({} as Prisma.TransactionClient);
  }) as unknown as Transaccion;
  return aleatorio ? Object.assign(abrir, { aleatorio }) : abrir;
}

describe("el azar del backoff entra desde afuera", () => {
  it("calcularEsperaBackoffMs usa la fuente que se le pasa; sin ninguna, la mitad del techo (nunca Math.random)", () => {
    expect(calcularEsperaBackoffMs(0, { baseMs: 100, topeMs: 1000, aleatorio: () => 0.25 })).toBe(25);
    expect(calcularEsperaBackoffMs(2, { baseMs: 100, topeMs: 1000, aleatorio: () => 1 })).toBe(400);
    // Sin fuente: determinista. Dos llamadas dan lo mismo (con Math.random no pasaría).
    const a = calcularEsperaBackoffMs(1, { baseMs: 100, topeMs: 1000 });
    expect(a).toBe(100);
    expect(calcularEsperaBackoffMs(1, { baseMs: 100, topeMs: 1000 })).toBe(a);
  });

  it("conTransaccionSerializable toma el azar de la transacción del borde (y una opción explícita lo pisa)", async () => {
    const esperas: number[] = [];
    const dormir = async (ms: number) => void esperas.push(ms);
    // La transacción trae su fuente (0,25, distinta de la mitad por defecto): 0,25 × min(250, 25 × 2^intento) = 6,25 y 12,5.
    await conTransaccionSerializable(transaccionQueFalla(2, () => 0.25), async () => "ok", 5, { dormir });
    expect(esperas).toEqual([6.25, 12.5]);
    esperas.length = 0;
    // Una fuente pedida a mano (un test) gana sobre la de la transacción.
    await conTransaccionSerializable(transaccionQueFalla(1, () => 0.25), async () => "ok", 5, { dormir, aleatorio: () => 1 });
    expect(esperas).toEqual([25]);
    esperas.length = 0;
    // Sin ninguna fuente: la mitad del techo.
    await conTransaccionSerializable(transaccionQueFalla(1), async () => "ok", 5, { dormir });
    expect(esperas).toEqual([12.5]);
  });

  it("conReintento sin fuente tampoco lee el azar del proceso: la espera es repetible", async () => {
    const corrida = async () => {
      const esperas: number[] = [];
      let n = 0;
      await conReintento(async () => { if (n++ < 2) throw new Error("x"); }, { maxIntentos: 4, esReintentable: () => true, dormir: async (ms) => void esperas.push(ms) });
      return esperas;
    };
    expect(await corrida()).toEqual(await corrida());
  });

  it("numeroEnUnidad convierte el entero del puerto en [0, 1)", () => {
    const fuente = (valor: number): FuenteDeAzar => ({ bytes: () => new Uint8Array(), entero: () => valor, uuid: () => "" });
    expect(numeroEnUnidad(fuente(0))).toBe(0);
    expect(numeroEnUnidad(fuente(500_000))).toBe(0.5);
    expect(numeroEnUnidad(fuente(999_999))).toBeLessThan(1);
  });

  it("toda transacción que sale de core/auth/base.ts trae la fuente de azar del proceso (la de producción)", () => {
    for (const transaccion of [baseDelContexto().transaccion, baseDeEmpresa("empresa-x").transaccion, transaccionDeLaEmpresa("empresa-x")]) {
      expect(typeof transaccion.aleatorio).toBe("function");
      const valor = transaccion.aleatorio!();
      expect(valor).toBeGreaterThanOrEqual(0);
      expect(valor).toBeLessThan(1);
    }
  });
});
