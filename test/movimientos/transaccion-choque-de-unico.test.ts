import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { conTransaccionSerializable, esChoqueDeIndiceUnico } from "../../src/core/movimientos/con-reintento";
import type { Transaccion } from "../../src/lib/db-tipos";

/**
 * Un choque de índice único dentro de una transacción SERIALIZABLE, cuando el perdedor de una carrera no leyó ese índice, llega como 23505 (P2002) y no como
 * 40001. `conTransaccionSerializable` lo repite SOLO si el caso de uso lo pidió (`tambienChoqueDeUnico`): ahí la repetición ve el estado del ganador y devuelve el
 * resultado de negocio. Sin pedirlo, el comportamiento de siempre: el P2002 se propaga en el acto (factura única, código duplicado).
 */
const SIN_ESPERA = { dormir: async () => undefined };

function p2002() {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "7.10.0" });
}

/** Una `Transaccion` falsa que cuenta intentos y falla con lo que se le diga en cada uno. */
function transaccionQueFalla(fallos: unknown[]): { transaccion: Transaccion; intentos: () => number } {
  let n = 0;
  const transaccion = (async (fn: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
    const fallo = fallos[n++];
    if (fallo !== undefined) throw fallo;
    return fn({} as Prisma.TransactionClient);
  }) as unknown as Transaccion;
  return { transaccion, intentos: () => n };
}

describe("conTransaccionSerializable y el choque de índice único", () => {
  it("con tambienChoqueDeUnico, un P2002 se repite y la repetición devuelve el resultado", async () => {
    const { transaccion, intentos } = transaccionQueFalla([p2002()]);
    const r = await conTransaccionSerializable(transaccion, async () => "resultado de negocio", 5, SIN_ESPERA, true);
    expect(r).toBe("resultado de negocio");
    expect(intentos()).toBe(2);
  });

  it("también reconoce el DriverAdapterError crudo con UniqueConstraintViolation", async () => {
    const crudo = Object.assign(new Error("duplicado"), { name: "DriverAdapterError", cause: { kind: "UniqueConstraintViolation" } });
    expect(esChoqueDeIndiceUnico(crudo)).toBe(true);
    const { transaccion } = transaccionQueFalla([crudo]);
    expect(await conTransaccionSerializable(transaccion, async () => "ok", 5, SIN_ESPERA, true)).toBe("ok");
  });

  it("si el choque es real y no cede, se propaga después de agotar los intentos", async () => {
    const { transaccion, intentos } = transaccionQueFalla([p2002(), p2002(), p2002()]);
    await expect(conTransaccionSerializable(transaccion, async () => "ok", 3, SIN_ESPERA, true)).rejects.toMatchObject({ code: "P2002" });
    expect(intentos()).toBe(3);
  });

  it("sin pedirlo, el P2002 se propaga en el primer intento, como siempre", async () => {
    const { transaccion, intentos } = transaccionQueFalla([p2002()]);
    await expect(conTransaccionSerializable(transaccion, async () => "ok", 5, SIN_ESPERA)).rejects.toMatchObject({ code: "P2002" });
    expect(intentos()).toBe(1);
  });

  it("otros errores nunca se repiten, ni siquiera pidiéndolo", async () => {
    const { transaccion, intentos } = transaccionQueFalla([new Error("conexión caída")]);
    await expect(conTransaccionSerializable(transaccion, async () => "ok", 5, SIN_ESPERA, true)).rejects.toThrow("conexión caída");
    expect(intentos()).toBe(1);
  });

  it("el conflicto de serialización de siempre (P2034) se sigue repitiendo sin pedir nada", async () => {
    const p2034 = new Prisma.PrismaClientKnownRequestError("write conflict", { code: "P2034", clientVersion: "7.10.0" });
    const { transaccion, intentos } = transaccionQueFalla([p2034]);
    expect(await conTransaccionSerializable(transaccion, async () => "ok", 5, SIN_ESPERA)).toBe("ok");
    expect(intentos()).toBe(2);
  });
});
