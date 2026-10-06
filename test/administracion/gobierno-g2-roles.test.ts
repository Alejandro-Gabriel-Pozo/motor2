import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, prisma, prismaAdmin, EMPRESA_POR_DEFECTO_ID } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { crearMembresia } from "../setup/membresia";
import { actualizarActivoRol } from "../../src/server/actions/permisos/roles";
import { contarAdminsEfectivos, contarUsuariosActivosDelRol } from "../../src/core/permisos/invariantes";

/**
 * Bloque G, G2: desactivar un rol. Los roles con clave técnica (admin y operador) son de sistema y no se apagan (D5); un rol sin clave no se
 * apaga mientras tenga membresías activas, sea cual sea su sucursal o su cuenta (D7, definición amplia).
 */
describe("G2: activar y desactivar roles", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
  });

  async function actuarComoAdmin() {
    const base = await sembrarBase();
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    return { base, admin };
  }

  it("D5: el rol «operador» (con clave) no se desactiva, aunque no tenga a nadie", async () => {
    const { base } = await actuarComoAdmin();

    const r = await actualizarActivoRol(base.operador.id, false);
    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/sistema/);
    expect((await prismaAdmin.rol.findUniqueOrThrow({ where: { id: base.operador.id } })).activo).toBe(true);
  });

  it("D5: el rol «admin» tampoco se desactiva", async () => {
    const { base } = await actuarComoAdmin();

    const r = await actualizarActivoRol(base.admin.id, false);
    expect(r.ok).toBe(false);
    expect((await prismaAdmin.rol.findUniqueOrThrow({ where: { id: base.admin.id } })).activo).toBe(true);
  });

  it("un rol sin clave y sin usuarios se desactiva y se vuelve a activar", async () => {
    await actuarComoAdmin();
    const cajero = await prisma.rol.create({ data: { nombre: "cajero" } });

    const apagado = await actualizarActivoRol(cajero.id, false);
    expect(apagado.ok, apagado.mensaje).toBe(true);
    expect((await prismaAdmin.rol.findUniqueOrThrow({ where: { id: cajero.id } })).activo).toBe(false);

    const prendido = await actualizarActivoRol(cajero.id, true);
    expect(prendido.ok, prendido.mensaje).toBe(true);
    expect((await prismaAdmin.rol.findUniqueOrThrow({ where: { id: cajero.id } })).activo).toBe(true);
  });

  it("D7: un rol con una membresía activa en una sucursal apagada tampoco se desactiva", async () => {
    const { base } = await actuarComoAdmin();
    const cajero = await prisma.rol.create({ data: { nombre: "cajero" } });
    const apagada = await prisma.sucursal.create({ data: { nombre: "Apagada", activo: false } });
    const persona = await crearUsuarioConMembresia({ email: "persona@test.com", sucursalId: base.sucursal.id, rolId: base.operador.id });
    await crearMembresia({ usuarioId: persona.id, sucursalId: apagada.id, rolId: cajero.id });

    const r = await actualizarActivoRol(cajero.id, false);
    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/usuarios activos/);
    expect((await prismaAdmin.rol.findUniqueOrThrow({ where: { id: cajero.id } })).activo).toBe(true);
  });

  it("D7: la definición amplia (cualquier membresía activa) y la estricta (admin que puede entrar) son dos preguntas distintas", async () => {
    const { base } = await actuarComoAdmin();
    const apagada = await prisma.sucursal.create({ data: { nombre: "Apagada", activo: false } });
    const otro = await crearUsuarioConMembresia({ email: "otro@test.com", sucursalId: apagada.id, rolId: base.admin.id });
    expect(otro.id).toBeTruthy();

    expect(await contarUsuariosActivosDelRol(prismaAdmin, base.admin.id)).toBe(2);
    expect(await contarAdminsEfectivos(prismaAdmin, EMPRESA_POR_DEFECTO_ID)).toBe(1);
  });
});
