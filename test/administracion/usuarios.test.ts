import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { actualizarActivoMembresia, actualizarActivoGlobalUsuario } from "../../src/server/actions/usuarios";

describe("actualizarActivoMembresia", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
  });

  it("desactiva una membresía de la propia sucursal", async () => {
    const base = await sembrarBase();
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    const operador = await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId: base.sucursal.id, rolId: base.operador.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });

    const membresia = await prisma.usuarioSucursal.findFirstOrThrow({ where: { usuarioId: operador.id } });
    const resultado = await actualizarActivoMembresia(membresia.id, false);
    expect(resultado.ok).toBe(true);
    expect((await prisma.usuarioSucursal.findUniqueOrThrow({ where: { id: membresia.id } })).activo).toBe(false);
  });

  it("rechaza tocar una membresía de otra sucursal, aunque el usuario tenga gestion_usuarios en la suya (hallazgo de la auditoría de backend)", async () => {
    const base = await sembrarBase();
    const otraSucursal = await prisma.sucursal.create({ data: { nombre: "Otra sucursal" } });
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    const operadorAjeno = await crearUsuarioConMembresia({ email: "ajeno@test.com", sucursalId: otraSucursal.id, rolId: base.operador.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });

    const membresiaAjena = await prisma.usuarioSucursal.findFirstOrThrow({ where: { usuarioId: operadorAjeno.id } });
    const resultado = await actualizarActivoMembresia(membresiaAjena.id, false);
    expect(resultado.ok).toBe(false);
    expect((await prisma.usuarioSucursal.findUniqueOrThrow({ where: { id: membresiaAjena.id } })).activo).toBe(true);
  });
});

describe("actualizarActivoGlobalUsuario", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
  });

  it("desactiva la cuenta a nivel sistema (kill-switch), sin tocar las membresías individuales", async () => {
    const base = await sembrarBase();
    const otraSucursal = await prisma.sucursal.create({ data: { nombre: "Otra sucursal" } });
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    const operador = await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId: base.sucursal.id, rolId: base.operador.id });
    await prisma.usuarioSucursal.create({ data: { usuarioId: operador.id, sucursalId: otraSucursal.id, rolId: base.operador.id, activo: true } });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });

    const resultado = await actualizarActivoGlobalUsuario(operador.id, false);
    expect(resultado.ok, resultado.mensaje).toBe(true);

    const usuario = await prisma.user.findUniqueOrThrow({ where: { id: operador.id } });
    expect(usuario.activoGlobal).toBe(false);
    // Ninguna fila UsuarioSucursal se tocó — el gate real vive en el login, no acá.
    const membresias = await prisma.usuarioSucursal.findMany({ where: { usuarioId: operador.id } });
    expect(membresias.every((m) => m.activo)).toBe(true);
  });

  it("rechaza si dejaría el sistema sin ningún admin activo, cruzando sucursales", async () => {
    const base = await sembrarBase();
    const otraSucursal = await prisma.sucursal.create({ data: { nombre: "Otra sucursal" } });
    const unicoAdmin = await crearUsuarioConMembresia({ email: "unico-admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    // Este admin también es admin en otra sucursal, pero sigue siendo la ÚNICA persona admin del sistema.
    await prisma.usuarioSucursal.create({ data: { usuarioId: unicoAdmin.id, sucursalId: otraSucursal.id, rolId: base.admin.id, activo: true } });
    await mockearUsuarioActual({ id: unicoAdmin.id, email: unicoAdmin.email, nombre: null });

    const resultado = await actualizarActivoGlobalUsuario(unicoAdmin.id, false);
    expect(resultado.ok).toBe(false);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: unicoAdmin.id } })).activoGlobal).toBe(true);
  });

  it("permite desactivar un admin si queda otro admin activo, aunque sea en otra sucursal", async () => {
    const base = await sembrarBase();
    const otraSucursal = await prisma.sucursal.create({ data: { nombre: "Otra sucursal" } });
    const adminA = await crearUsuarioConMembresia({ email: "admin-a@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await crearUsuarioConMembresia({ email: "admin-b@test.com", sucursalId: otraSucursal.id, rolId: base.admin.id });
    await mockearUsuarioActual({ id: adminA.id, email: adminA.email, nombre: null });

    const resultado = await actualizarActivoGlobalUsuario(adminA.id, false);
    expect(resultado.ok, resultado.mensaje).toBe(true);
  });

  it("reactivar una cuenta desactivada funciona sin restricción de admin", async () => {
    const base = await sembrarBase();
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    const operador = await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId: base.sucursal.id, rolId: base.operador.id });
    await prisma.user.update({ where: { id: operador.id }, data: { activoGlobal: false } });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });

    const resultado = await actualizarActivoGlobalUsuario(operador.id, true);
    expect(resultado.ok, resultado.mensaje).toBe(true);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: operador.id } })).activoGlobal).toBe(true);
  });
});
