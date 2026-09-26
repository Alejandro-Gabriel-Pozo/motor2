import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { actualizarMaxMesasAbiertas } from "../../src/server/actions/pos/mesas";

/**
 * Límite de mesas abiertas por sucursal (src/server/actions/pos/mesas.ts, docs/plan-comensales-y-limite-mesas-2026-09-26.md):
 * validación, mismo permiso que dar de alta mesas (`pos_mesas`, Editar) y auditoría.
 */
describe("actualizarMaxMesasAbiertas (server action)", () => {
  let base: Awaited<ReturnType<typeof sembrarBase>>;
  let sucursalId: string;
  let adminId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    adminId = admin.id;
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  const sucursal = () => prisma.sucursal.findUniqueOrThrow({ where: { id: sucursalId } });

  it("un admin fija un límite, auditado", async () => {
    const r = await actualizarMaxMesasAbiertas(5);
    expect(r).toEqual({ ok: true, mensaje: "Máximo de mesas abiertas en «Central»: 5." });
    expect((await sucursal()).maxMesasAbiertas).toBe(5);

    const auditoria = await prisma.registroAuditoria.findMany({ where: { entidad: "Sucursal", entidadId: sucursalId } });
    expect(auditoria).toHaveLength(1);
    expect(auditoria[0]).toMatchObject({ campo: "maxMesasAbiertas", valorAnterior: null, valorNuevo: "5", actorId: adminId, sucursalId });
  });

  it("volver a null (sin límite) también se audita, y el mensaje lo dice", async () => {
    await actualizarMaxMesasAbiertas(3);
    const r = await actualizarMaxMesasAbiertas(null);
    expect(r).toEqual({ ok: true, mensaje: "Sin límite de mesas abiertas en «Central»." });
    expect((await sucursal()).maxMesasAbiertas).toBeNull();
    expect(await prisma.registroAuditoria.count({ where: { entidad: "Sucursal", entidadId: sucursalId } })).toBe(2);
  });

  it("guardar el mismo valor no duplica auditoría (no-op de registrarCambioAuditado)", async () => {
    await actualizarMaxMesasAbiertas(5);
    await actualizarMaxMesasAbiertas(5);
    expect(await prisma.registroAuditoria.count({ where: { entidad: "Sucursal", entidadId: sucursalId } })).toBe(1);
  });

  it("rechaza valores inválidos (0, negativo, decimal, NaN, más de 9999), sin tocar el límite vigente", async () => {
    await actualizarMaxMesasAbiertas(10);
    for (const invalido of [0, -1, 1.5, Number.NaN, 10000]) {
      const r = await actualizarMaxMesasAbiertas(invalido);
      expect(r.ok, `límite ${invalido}`).toBe(false);
    }
    expect((await sucursal()).maxMesasAbiertas).toBe(10);
  });

  it("un rol sin pos_mesas (el operador de fábrica) no puede", async () => {
    const operador = await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId, rolId: base.operador.id });
    await mockearUsuarioActual({ id: operador.id, email: operador.email, nombre: null });
    const r = await actualizarMaxMesasAbiertas(5);
    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/No tenés permiso/);
    expect((await sucursal()).maxMesasAbiertas).toBeNull();
  });

  it("con Ver pero sin Editar de pos_mesas, tampoco", async () => {
    await prisma.permisoRol.update({ where: { rolId_accionClave: { rolId: base.operador.id, accionClave: "pos_mesas" } }, data: { puedeVer: true, puedeEditar: false } });
    const operador = await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId, rolId: base.operador.id });
    await mockearUsuarioActual({ id: operador.id, email: operador.email, nombre: null });
    const r = await actualizarMaxMesasAbiertas(5);
    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/No tenés permiso/);
  });

  it("si la Central deshabilitó pos_mesas para la sucursal, ni el admin puede", async () => {
    await prisma.capacidadSucursal.create({ data: { accionClave: "pos_mesas", sucursalId, habilitado: false } });
    const r = await actualizarMaxMesasAbiertas(5);
    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/no habilitó "pos_mesas"/);
  });
});
