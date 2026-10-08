import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

/**
 * Qué error tira la escritura simulada (o ninguno). Con el adaptador `pg` de Prisma 7 el mismo choque de índice único puede llegar como `P2002` o como el
 * `DriverAdapterError` CRUDO (`cause.kind === "UniqueConstraintViolation"`): la forma que reconoce `esChoqueDeIndiceUnico` (Pureza 1.7, `test/core/errores-de-base.test.ts`).
 */
const falla = vi.hoisted(() => ({ kind: null as string | null }));
const errorDelDriver = (kind: string) => Object.assign(new Error("driver"), { name: "DriverAdapterError", cause: { kind } });

vi.mock("../../src/server/persistencia/pos/mesas", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/server/persistencia/pos/mesas")>();
  return {
    ...original,
    escribirMesaNueva: (...args: Parameters<typeof original.escribirMesaNueva>) => {
      if (falla.kind) throw errorDelDriver(falla.kind);
      return original.escribirMesaNueva(...args);
    },
  };
});
vi.mock("../../src/server/persistencia/pos/cuenta", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/server/persistencia/pos/cuenta")>();
  return {
    ...original,
    abrirCuentaDeMesa: (...args: Parameters<typeof original.abrirCuentaDeMesa>) => {
      if (falla.kind) throw errorDelDriver(falla.kind);
      return original.abrirCuentaDeMesa(...args);
    },
  };
});

import { limpiarBaseDeTest, prisma } from "../setup/test-db";
import { entrarComo, sembrarSalon } from "./salon-fixture";
import { crearMesa } from "../../src/server/actions/pos/mesas";
import { abrirCuenta } from "../../src/server/actions/pos/cuenta-apertura";

/**
 * B2 del Hito 4 (aprobado por el dueño, 2026-10-08; `docs/plan-hito-4-pureza.md` §5): `crearMesa` y `abrirCuenta` reconocen el choque del índice único con
 * `esChoqueDeIndiceUnico` (el helper de 1.7), que ve también el `DriverAdapterError` crudo, y no con `esErrorDeUnicidad` (solo `P2002`). Antes, un choque que
 * llegaba con la forma del driver no se traducía: la acción lanzaba en lugar de responder «Ya existe la mesa N» (alta) o «ya tenía una cuenta abierta»
 * (apertura, el perdedor de dos aperturas simultáneas). Otro error del driver NO se disfraza de choque: sigue lanzando.
 */
describe("el choque de unicidad con la forma del driver (DriverAdapterError)", () => {
  let s: Awaited<ReturnType<typeof sembrarSalon>>;

  beforeEach(async () => {
    falla.kind = null;
    await limpiarBaseDeTest();
    s = await sembrarSalon();
    await entrarComo(s.admin);
  });

  it("crearMesa: responde «Ya existe la mesa N» y no lanza", async () => {
    falla.kind = "UniqueConstraintViolation";
    expect(await crearMesa(7)).toEqual({ ok: false, mensaje: "Ya existe la mesa 7 en esta sucursal." });
    expect(await prisma.mesa.count({ where: { numero: 7 } })).toBe(0);
  });

  it("abrirCuenta: el perdedor ve la mesa con su cuenta (ok) y no lanza", async () => {
    falla.kind = "UniqueConstraintViolation";
    expect(await abrirCuenta(s.mesa.id, 2)).toEqual({ ok: true, mensaje: `La mesa ${s.mesa.numero} ya tenía una cuenta abierta.` });
  });

  it("otro error del driver no se toma por un choque: las dos siguen lanzando", async () => {
    falla.kind = "ConnectionClosed";
    await expect(crearMesa(7)).rejects.toThrow("driver");
    await expect(abrirCuenta(s.mesa.id, 2)).rejects.toThrow("driver");
  });
});
