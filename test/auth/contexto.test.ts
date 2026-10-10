import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { __setCookieDeTestParaSucursal } from "../setup/next-headers-stub";
import { obtenerContextoUsuario } from "../../src/core/auth/contexto";
import { crearMembresia } from "../setup/membresia";

describe("obtenerContextoUsuario — selector de sucursal", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
    __setCookieDeTestParaSucursal(undefined);
  });

  it("con una sola membresía, no hay nada que elegir y membresias trae ese único elemento", async () => {
    const base = await sembrarBase();
    const usuario = await crearUsuarioConMembresia({ email: "solo@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await mockearUsuarioActual({ id: usuario.id, email: usuario.email, nombre: null });

    const ctx = await obtenerContextoUsuario();
    expect(ctx?.sucursalId).toBe(base.sucursal.id);
    expect(ctx?.membresias).toHaveLength(1);
  });

  it("con varias membresías y sin cookie, usa la más antigua (mismo MVP de antes)", async () => {
    const base = await sembrarBase();
    const sucursal2 = await prisma.sucursal.create({ data: { nombre: "Norte" } });
    const usuario = await crearUsuarioConMembresia({ email: "multi@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    // Creada después — no debería ganar sin cookie.
    await crearMembresia({ usuarioId: usuario.id, sucursalId: sucursal2.id, rolId: base.admin.id, activo: true });
    await mockearUsuarioActual({ id: usuario.id, email: usuario.email, nombre: null });

    const ctx = await obtenerContextoUsuario();
    expect(ctx?.sucursalId).toBe(base.sucursal.id);
    expect(ctx?.membresias.map((m) => m.sucursalId).sort()).toEqual([base.sucursal.id, sucursal2.id].sort());
  });

  it("con cookie apuntando a una membresía real del usuario, esa gana", async () => {
    const base = await sembrarBase();
    const sucursal2 = await prisma.sucursal.create({ data: { nombre: "Norte" } });
    const usuario = await crearUsuarioConMembresia({ email: "multi@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await crearMembresia({ usuarioId: usuario.id, sucursalId: sucursal2.id, rolId: base.admin.id, activo: true });
    await mockearUsuarioActual({ id: usuario.id, email: usuario.email, nombre: null });

    __setCookieDeTestParaSucursal(sucursal2.id);
    const ctx = await obtenerContextoUsuario();
    expect(ctx?.sucursalId).toBe(sucursal2.id);
  });

  it("una cookie apuntando a una sucursal a la que el usuario NO pertenece se ignora — nunca se confía a ciegas", async () => {
    const base = await sembrarBase();
    const sucursalAjena = await prisma.sucursal.create({ data: { nombre: "No es mía" } });
    const usuario = await crearUsuarioConMembresia({ email: "solo@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await mockearUsuarioActual({ id: usuario.id, email: usuario.email, nombre: null });

    __setCookieDeTestParaSucursal(sucursalAjena.id);
    const ctx = await obtenerContextoUsuario();
    expect(ctx?.sucursalId).toBe(base.sucursal.id);
  });

  it("una membresía inactiva o de una sucursal inactiva no cuenta ni como default ni vía cookie", async () => {
    const base = await sembrarBase();
    const sucursalInactiva = await prisma.sucursal.create({ data: { nombre: "Cerrada", activo: false } });
    const usuario = await crearUsuarioConMembresia({ email: "solo@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await crearMembresia({ usuarioId: usuario.id, sucursalId: sucursalInactiva.id, rolId: base.admin.id, activo: true });
    await mockearUsuarioActual({ id: usuario.id, email: usuario.email, nombre: null });

    __setCookieDeTestParaSucursal(sucursalInactiva.id);
    const ctx = await obtenerContextoUsuario();
    expect(ctx?.sucursalId).toBe(base.sucursal.id);
    expect(ctx?.membresias).toHaveLength(1);
  });
});

/**
 * M.3-A3: el ALCANCE por sucursal con el que arranca todo pedido es la sucursal ACTIVA (D1 del plan): lectura = escritura = [activa]. Las otras membresías del usuario NO
 * suman alcance (se ensancha después del gate, `server/acceso/alcance.ts`), y la base del contexto (`db` y `transaccion`) lo trae fijado en la transacción.
 */
describe("obtenerContextoUsuario — alcance por sucursal (M.3-A3)", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
    __setCookieDeTestParaSucursal(undefined);
  });

  const variables = async (cliente: Pick<typeof prisma, "$queryRaw">) =>
    (await cliente.$queryRaw<Array<{ empresa: string | null; lectura: string | null; escritura: string | null }>>`
      SELECT current_setting('app.empresa_id', true) AS empresa, current_setting('app.sucursales_lectura', true) AS lectura, current_setting('app.sucursales_escritura', true) AS escritura`)[0];

  it("con una sola membresía: lectura = escritura = [la activa], y la base lo fija", async () => {
    const base = await sembrarBase();
    const usuario = await crearUsuarioConMembresia({ email: "solo@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await mockearUsuarioActual({ id: usuario.id, email: usuario.email, nombre: null });

    const ctx = await obtenerContextoUsuario();
    expect(ctx?.alcance).toEqual({ lectura: [base.sucursal.id], escritura: [base.sucursal.id] });
    expect(await variables(ctx!.db)).toEqual({ empresa: ctx!.empresaId, lectura: base.sucursal.id, escritura: base.sucursal.id });
    expect(await ctx!.transaccion((tx) => variables(tx))).toEqual({ empresa: ctx!.empresaId, lectura: base.sucursal.id, escritura: base.sucursal.id });
  });

  it("con varias membresías: lectura = activa (NO todas las membresías), con y sin cookie", async () => {
    const base = await sembrarBase();
    const sucursal2 = await prisma.sucursal.create({ data: { nombre: "Norte" } });
    const sucursal3 = await prisma.sucursal.create({ data: { nombre: "Sur" } });
    const usuario = await crearUsuarioConMembresia({ email: "multi@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await crearMembresia({ usuarioId: usuario.id, sucursalId: sucursal2.id, rolId: base.admin.id, activo: true });
    await crearMembresia({ usuarioId: usuario.id, sucursalId: sucursal3.id, rolId: base.admin.id, activo: true });
    await mockearUsuarioActual({ id: usuario.id, email: usuario.email, nombre: null });

    const sinCookie = await obtenerContextoUsuario();
    expect(sinCookie?.membresias).toHaveLength(3);
    expect(sinCookie?.alcance).toEqual({ lectura: [base.sucursal.id], escritura: [base.sucursal.id] });
    expect((await variables(sinCookie!.db)).lectura).toBe(base.sucursal.id);

    __setCookieDeTestParaSucursal(sucursal3.id);
    const conCookie = await obtenerContextoUsuario();
    expect(conCookie?.sucursalId).toBe(sucursal3.id);
    expect(conCookie?.alcance).toEqual({ lectura: [sucursal3.id], escritura: [sucursal3.id] });
    expect(await variables(conCookie!.db)).toMatchObject({ lectura: sucursal3.id, escritura: sucursal3.id });
  });

  it("una cookie con una sucursal ajena o inactiva no entra al alcance: queda la activa real", async () => {
    const base = await sembrarBase();
    const ajena = await prisma.sucursal.create({ data: { nombre: "No es mía" } });
    const inactiva = await prisma.sucursal.create({ data: { nombre: "Cerrada", activo: false } });
    const usuario = await crearUsuarioConMembresia({ email: "solo@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await crearMembresia({ usuarioId: usuario.id, sucursalId: inactiva.id, rolId: base.admin.id, activo: true });
    await mockearUsuarioActual({ id: usuario.id, email: usuario.email, nombre: null });

    for (const intento of [ajena.id, inactiva.id]) {
      __setCookieDeTestParaSucursal(intento);
      const ctx = await obtenerContextoUsuario();
      expect(ctx?.alcance).toEqual({ lectura: [base.sucursal.id], escritura: [base.sucursal.id] });
    }
  });
});
