import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

/**
 * La hora que fija el envoltorio (`ctx.ahora`): el guard es el REAL; solo se reemplaza la hora que `conGate` le entrega a la acción, como si el pedido hubiera
 * llegado en `reloj.fija`. Así se distingue una acción que lee `ctx.ahora` de una que lee el reloj por su cuenta (con relojes falsos las dos verían lo mismo).
 * Molde: `test/administracion/usuarios-hora-del-pedido.test.ts`.
 */
const reloj = vi.hoisted(() => ({ fija: null as Date | null }));
vi.mock("../../src/server/actions/con-permiso", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/server/actions/con-permiso")>();
  const conLaHoraFija =
    <C extends { ahora: Date }, R>(fn: (ctx: C) => Promise<R>) =>
    (ctx: C) =>
      fn(reloj.fija ? { ...ctx, ahora: reloj.fija } : ctx);
  return {
    ...real,
    conPermiso: ((clave, fn) => real.conPermiso(clave, conLaHoraFija(fn))) as typeof real.conPermiso,
  };
});

import { limpiarBaseDeTest, prisma } from "../setup/test-db";
import { DIA_MS, enElPasado } from "../setup/tiempo";
import { entrarComo, sembrarCuenta, sembrarSalon } from "./salon-fixture";
import { liberarMesa } from "../../src/server/actions/pos/cuenta-apertura";

/**
 * Reloj de `liberarMesa` (Hito 4, `docs/plan-hito-4-pureza.md` §5; APROBADO por el dueño el 2026-10-08): la cuenta liberada queda cerrada con la hora del
 * pedido (`ctx.ahora`, que `conPermiso` fija una vez, Pureza 1.2), no con un `new Date()` propio. Era el único reloj de las 10 acciones del POS sin caso de uso;
 * `cerrarCuenta` ya cerraba con `actor.ahora`. Escrito ANTES del cambio: contra el código viejo, `cerradaEn` es la hora real y el test da rojo.
 */
let s: Awaited<ReturnType<typeof sembrarSalon>>;

beforeEach(async () => {
  reloj.fija = null;
  await limpiarBaseDeTest();
  s = await sembrarSalon();
  await entrarComo(s.admin);
});

afterEach(() => {
  reloj.fija = null;
});

describe("liberarMesa: la hora es la del pedido (ctx.ahora), no la del reloj", () => {
  it("la cuenta liberada queda cerrada con la hora del pedido y a nombre de quien la liberó", async () => {
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id);
    reloj.fija = enElPasado(3 * DIA_MS);
    const r = await liberarMesa(cuenta.id);
    expect(r).toEqual({ ok: true, mensaje: "Mesa 4 liberada." });
    const cerrada = await prisma.cuenta.findUniqueOrThrow({ where: { id: cuenta.id } });
    expect(cerrada.cerradaEn?.getTime()).toBe(reloj.fija.getTime());
    expect(cerrada.cerradaPorId).toBe(s.admin.id);
  });
});
