import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { actualizarActivoSucursal, renombrarSucursal } from "../../src/server/actions/auth/sucursales";

describe("actualizarActivoSucursal / renombrarSucursal", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
  });

  async function armarAdmin() {
    const base = await sembrarBase();
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    return base;
  }

  it("desactiva una sucursal existente — antes solo se podía crear, nunca desactivar (hallazgo de la auditoría)", async () => {
    const base = await armarAdmin();
    const otra = await prisma.sucursal.create({ data: { nombre: "Otra sucursal" } });

    const resultado = await actualizarActivoSucursal(otra.id, false);
    expect(resultado.ok, resultado.mensaje).toBe(true);
    expect((await prisma.sucursal.findUniqueOrThrow({ where: { id: otra.id } })).activo).toBe(false);
    void base;
  });

  it("rechaza desactivar la sucursal en la que está el usuario: se quedaría sin acceso y no podría volver a activarla", async () => {
    const base = await armarAdmin();

    const resultado = await actualizarActivoSucursal(base.sucursal.id, false);
    expect(resultado.ok).toBe(false);
    expect(resultado.mensaje).toContain("la sucursal en la que estás ahora");
    expect((await prisma.sucursal.findUniqueOrThrow({ where: { id: base.sucursal.id } })).activo).toBe(true);
  });

  it("reactiva una sucursal desactivada", async () => {
    await armarAdmin();
    const otra = await prisma.sucursal.create({ data: { nombre: "Otra sucursal", activo: false } });

    const resultado = await actualizarActivoSucursal(otra.id, true);
    expect(resultado.ok, resultado.mensaje).toBe(true);
    expect((await prisma.sucursal.findUniqueOrThrow({ where: { id: otra.id } })).activo).toBe(true);
  });

  it("rechaza tocar una sucursal inexistente", async () => {
    await armarAdmin();
    const resultado = await actualizarActivoSucursal("no-existe", false);
    expect(resultado.ok).toBe(false);
  });

  it("renombra una sucursal existente", async () => {
    await armarAdmin();
    const otra = await prisma.sucursal.create({ data: { nombre: "Nombre viejo" } });

    const resultado = await renombrarSucursal(otra.id, "Nombre nuevo");
    expect(resultado.ok, resultado.mensaje).toBe(true);
    expect((await prisma.sucursal.findUniqueOrThrow({ where: { id: otra.id } })).nombre).toBe("Nombre nuevo");
  });

  it("rechaza renombrar a un nombre que ya usa otra sucursal, ignorando mayúsculas", async () => {
    await armarAdmin();
    await prisma.sucursal.create({ data: { nombre: "Sucursal Norte" } });
    const otra = await prisma.sucursal.create({ data: { nombre: "Sucursal Sur" } });

    const resultado = await renombrarSucursal(otra.id, "sucursal norte");
    expect(resultado.ok).toBe(false);
    expect((await prisma.sucursal.findUniqueOrThrow({ where: { id: otra.id } })).nombre).toBe("Sucursal Sur");
  });

  it("un operador (sin alta_sucursal) no puede desactivar ni renombrar", async () => {
    const base = await sembrarBase();
    const operador = await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId: base.sucursal.id, rolId: base.operador.id });
    await mockearUsuarioActual({ id: operador.id, email: operador.email, nombre: null });
    const otra = await prisma.sucursal.create({ data: { nombre: "Otra sucursal" } });

    expect((await actualizarActivoSucursal(otra.id, false)).ok).toBe(false);
    expect((await renombrarSucursal(otra.id, "Nuevo nombre")).ok).toBe(false);
  });
});
