import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { conReintento } from "../../src/core/movimientos/reintentar";
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
  const config = () => ({ maxIntentos: 5, esReintentable: esConflictoDeEscritura, alResolverPorReintento: vi.fn(), alAgotar: vi.fn() });

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
