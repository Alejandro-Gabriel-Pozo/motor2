import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, prisma, prismaAdmin, EMPRESA_POR_DEFECTO_ID } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { __setCookieDeTestParaSucursal } from "../setup/next-headers-stub";
import { conGobierno } from "../../src/server/actions/con-gobierno";
import { conInvariantesDeGobierno } from "../../src/core/permisos/invariantes";
import { ok } from "../../src/server/actions/tipos";
import { actualizarActivoSucursal, crearSucursalConAdmin } from "../../src/server/actions/auth/sucursales";

/**
 * Bloque G, G2: las sucursales dentro de la transacción de gobierno. Apagar una sucursal no puede dejar a la empresa sin admin efectivo (D9) y el
 * rol «admin» se busca por su clave técnica, no por su nombre.
 */

const hacerGerente = (usuarioId: string) =>
  prismaAdmin.usuarioEmpresa.update({ where: { usuarioId_empresaId: { usuarioId, empresaId: EMPRESA_POR_DEFECTO_ID } }, data: { rolEmpresa: "gerente" } });

describe("G2: sucursales", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
  });
  afterEach(() => {
    __setCookieDeTestParaSucursal(undefined);
  });

  it("D9: apagar la sucursal del único admin efectivo se deshace (la red de seguridad de actualizarActivoSucursal; por la acción no se llega: quien actúa es admin en la suya)", async () => {
    const base = await sembrarBase();
    const norte = await prisma.sucursal.create({ data: { nombre: "Norte" } });
    await crearUsuarioConMembresia({ email: "admin-norte@test.com", sucursalId: norte.id, rolId: base.admin.id });
    const ctx = { transaccion: ((fn, opciones) => prismaAdmin.$transaction(fn, opciones)) as Parameters<typeof conGobierno>[0]["transaccion"] };

    const r = await conGobierno(ctx, (tx) => conInvariantesDeGobierno(tx, EMPRESA_POR_DEFECTO_ID, async () => {
      await tx.sucursal.update({ where: { id: norte.id }, data: { activo: false } });
      return ok("apagada");
    }));

    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/admin activo/);
    expect((await prismaAdmin.sucursal.findUniqueOrThrow({ where: { id: norte.id } })).activo).toBe(true);
  });

  it("D9 (control): si queda otro admin efectivo en otra sucursal, se apaga", async () => {
    const base = await sembrarBase();
    const gerente = await crearUsuarioConMembresia({ email: "gerente@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await hacerGerente(gerente.id);
    const norte = await prisma.sucursal.create({ data: { nombre: "Norte" } });
    await crearUsuarioConMembresia({ email: "admin-norte@test.com", sucursalId: norte.id, rolId: base.admin.id });
    __setCookieDeTestParaSucursal(base.sucursal.id);
    await mockearUsuarioActual({ id: gerente.id, email: gerente.email, nombre: null });

    const r = await actualizarActivoSucursal(norte.id, false);
    expect(r.ok, r.mensaje).toBe(true);
    expect((await prismaAdmin.sucursal.findUniqueOrThrow({ where: { id: norte.id } })).activo).toBe(false);
  });

  it("el rol admin se busca por clave: si le cambian el nombre, crear una sucursal con su primer admin sigue andando", async () => {
    const base = await sembrarBase();
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await prismaAdmin.rol.update({ where: { id: base.admin.id }, data: { nombre: "Encargado" } });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });

    const r = await crearSucursalConAdmin({ nombre: "Sur", emailPrimerAdmin: "nuevo-admin@test.com" });
    expect(r.ok, r.mensaje).toBe(true);
    const membresia = await prismaAdmin.usuarioSucursal.findFirstOrThrow({ where: { sucursal: { nombre: "Sur" } }, include: { rol: true } });
    expect(membresia.rol.clave).toBe("admin");
  });

  it("un admin que no es el gerente no reactiva, como primer admin, a un ex admin con la cuenta apagada; la sucursal no queda creada", async () => {
    const base = await sembrarBase();
    const actor = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    const exAdmin = await crearUsuarioConMembresia({ email: "ex@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await prismaAdmin.usuarioEmpresa.update({ where: { usuarioId_empresaId: { usuarioId: exAdmin.id, empresaId: EMPRESA_POR_DEFECTO_ID } }, data: { activo: false } });
    await mockearUsuarioActual({ id: actor.id, email: actor.email, nombre: null });

    const r = await crearSucursalConAdmin({ nombre: "Oeste", emailPrimerAdmin: "ex@test.com" });
    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/gerente/);
    expect(await prismaAdmin.sucursal.findFirst({ where: { nombre: "Oeste" } })).toBeNull();
  });
});
