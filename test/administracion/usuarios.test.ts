import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { actualizarActivoMembresia } from "../../src/server/actions/usuarios";

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
