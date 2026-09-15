import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { __setCookieDeTestParaSucursal } from "../setup/next-headers-stub";
import { obtenerContextoUsuario } from "../../src/core/auth/contexto";

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
    await prisma.usuarioSucursal.create({ data: { usuarioId: usuario.id, sucursalId: sucursal2.id, rolId: base.admin.id, activo: true } });
    await mockearUsuarioActual({ id: usuario.id, email: usuario.email, nombre: null });

    const ctx = await obtenerContextoUsuario();
    expect(ctx?.sucursalId).toBe(base.sucursal.id);
    expect(ctx?.membresias.map((m) => m.sucursalId).sort()).toEqual([base.sucursal.id, sucursal2.id].sort());
  });

  it("con cookie apuntando a una membresía real del usuario, esa gana", async () => {
    const base = await sembrarBase();
    const sucursal2 = await prisma.sucursal.create({ data: { nombre: "Norte" } });
    const usuario = await crearUsuarioConMembresia({ email: "multi@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await prisma.usuarioSucursal.create({ data: { usuarioId: usuario.id, sucursalId: sucursal2.id, rolId: base.admin.id, activo: true } });
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
    await prisma.usuarioSucursal.create({ data: { usuarioId: usuario.id, sucursalId: sucursalInactiva.id, rolId: base.admin.id, activo: true } });
    await mockearUsuarioActual({ id: usuario.id, email: usuario.email, nombre: null });

    __setCookieDeTestParaSucursal(sucursalInactiva.id);
    const ctx = await obtenerContextoUsuario();
    expect(ctx?.sucursalId).toBe(base.sucursal.id);
    expect(ctx?.membresias).toHaveLength(1);
  });
});
