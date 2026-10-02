import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, prisma, prismaAdmin } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { crearMembresia } from "../setup/membresia";
import { actualizarActivoSucursal, crearSucursalConAdmin, renombrarSucursal } from "../../src/server/actions/auth/sucursales";
import { actualizarActivoMembresia, actualizarActivoUsuarioEnEmpresa, agregarOActualizarUsuario } from "../../src/server/actions/auth/usuarios";
import { crearRol } from "../../src/server/actions/permisos/roles";

/** Lote S-1 (parte A): S-09 (el gerente no se queda sin sucursal activa) y S-10 (reactivar a un admin es del gerente; altas y bajas auditadas). */

const hacerGerente = (usuarioId: string, empresaId: string) =>
  prismaAdmin.usuarioEmpresa.update({ where: { usuarioId_empresaId: { usuarioId, empresaId } }, data: { rolEmpresa: "gerente" } });
const auditoria = (entidad: string) => prismaAdmin.registroAuditoria.findMany({ where: { entidad }, orderBy: { creadoEn: "asc" } });
const actuarComo = (u: { id: string; email: string }) => mockearUsuarioActual({ id: u.id, email: u.email, nombre: null });

describe("S-09: actualizarActivoSucursal no deja al gerente sin sucursal activa", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
  });

  async function armar() {
    const base = await sembrarBase();
    const empresaId = base.sucursal.empresaId;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    const otra = await prismaAdmin.sucursal.create({ data: { nombre: "Otra", empresaId } });
    const gerente = await crearUsuarioConMembresia({ email: "gerente@test.com", sucursalId: otra.id, rolId: base.admin.id });
    await hacerGerente(gerente.id, empresaId);
    await actuarComo(admin);
    return { base, otra, gerente, empresaId };
  }

  it("rechaza apagar la única sucursal activa del gerente y no toca la sucursal ni deja rastro", async () => {
    const { otra } = await armar();

    const r = await actualizarActivoSucursal(otra.id, false);
    expect(r.ok).toBe(false);
    expect(r.mensaje).toContain("gerente@test.com");
    expect((await prisma.sucursal.findUniqueOrThrow({ where: { id: otra.id } })).activo).toBe(true);
    expect(await auditoria("Sucursal")).toHaveLength(0);
  });

  it("si el gerente tiene otra membresía activa en otra sucursal activa, se puede apagar", async () => {
    const { base, otra, gerente } = await armar();
    await crearMembresia({ usuarioId: gerente.id, sucursalId: base.sucursal.id, rolId: base.admin.id });

    const r = await actualizarActivoSucursal(otra.id, false);
    expect(r.ok, r.mensaje).toBe(true);
    expect((await prisma.sucursal.findUniqueOrThrow({ where: { id: otra.id } })).activo).toBe(false);
  });

  it("una membresía del gerente en una sucursal ya apagada, o inactiva, no cuenta", async () => {
    const { base, otra, gerente, empresaId } = await armar();
    const apagada = await prismaAdmin.sucursal.create({ data: { nombre: "Apagada", empresaId, activo: false } });
    await crearMembresia({ usuarioId: gerente.id, sucursalId: apagada.id, rolId: base.admin.id });
    await crearMembresia({ usuarioId: gerente.id, sucursalId: base.sucursal.id, rolId: base.admin.id, activo: false });

    const r = await actualizarActivoSucursal(otra.id, false);
    expect(r.ok).toBe(false);
    expect((await prisma.sucursal.findUniqueOrThrow({ where: { id: otra.id } })).activo).toBe(true);
  });

  it("apagar una sucursal sin gerente adentro funciona y queda auditado (anterior true, nuevo false, solo el gerente la ve)", async () => {
    const { base, gerente } = await armar();
    const libre = await prismaAdmin.sucursal.create({ data: { nombre: "Libre", empresaId: base.sucursal.empresaId } });

    const r = await actualizarActivoSucursal(libre.id, false);
    expect(r.ok, r.mensaje).toBe(true);
    const filas = await auditoria("Sucursal");
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ entidadId: libre.id, campo: "activo", valorAnterior: "true", valorNuevo: "false", sucursalId: null });
    expect(filas[0]!.actorId).not.toBe(gerente.id);

    await actualizarActivoSucursal(libre.id, true);
    expect((await auditoria("Sucursal")).map((f) => f.valorNuevo)).toEqual(["false", "true"]);
  });

  it("repetir el mismo estado no ensucia el registro", async () => {
    const { base } = await armar();
    const libre = await prismaAdmin.sucursal.create({ data: { nombre: "Libre", empresaId: base.sucursal.empresaId } });
    await actualizarActivoSucursal(libre.id, true);
    expect(await auditoria("Sucursal")).toHaveLength(0);
  });

  it("renombrar una sucursal queda auditado", async () => {
    const { base } = await armar();
    const libre = await prismaAdmin.sucursal.create({ data: { nombre: "Vieja", empresaId: base.sucursal.empresaId } });
    const r = await renombrarSucursal(libre.id, "Nueva");
    expect(r.ok, r.mensaje).toBe(true);
    expect((await auditoria("Sucursal"))[0]).toMatchObject({ entidadId: libre.id, campo: "nombre", valorAnterior: "Vieja", valorNuevo: "Nueva" });
  });
});

describe("S-10: reactivar a un administrador es solo del gerente", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
  });

  /** gerente + admin1 (actor, no gerente) + admin2 con cuenta de empresa y membresía APAGADAS + un operador apagado. */
  async function armar() {
    const base = await sembrarBase();
    const empresaId = base.sucursal.empresaId;
    const gerente = await crearUsuarioConMembresia({ email: "gerente@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await hacerGerente(gerente.id, empresaId);
    const admin1 = await crearUsuarioConMembresia({ email: "admin1@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    const admin2 = await crearUsuarioConMembresia({ email: "admin2@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    const operador = await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId: base.sucursal.id, rolId: base.operador.id });
    await prismaAdmin.usuarioEmpresa.updateMany({ where: { usuarioId: { in: [admin2.id, operador.id] } }, data: { activo: false } });
    await prismaAdmin.usuarioSucursal.updateMany({ where: { usuarioId: { in: [admin2.id, operador.id] } }, data: { activo: false } });
    return { base, empresaId, gerente, admin1, admin2, operador };
  }

  const cuentaActiva = (usuarioId: string, empresaId: string) =>
    prismaAdmin.usuarioEmpresa.findUniqueOrThrow({ where: { usuarioId_empresaId: { usuarioId, empresaId } } }).then((f) => f.activo);

  it("actualizarActivoUsuarioEnEmpresa: un admin no reactiva la cuenta de otro admin apagado; el gerente sí", async () => {
    const { empresaId, gerente, admin1, admin2 } = await armar();

    await actuarComo(admin1);
    const r = await actualizarActivoUsuarioEnEmpresa(admin2.id, true);
    expect(r.ok).toBe(false);
    expect(r.mensaje).toContain("gerente");
    expect(await cuentaActiva(admin2.id, empresaId)).toBe(false);

    await actuarComo(gerente);
    const rg = await actualizarActivoUsuarioEnEmpresa(admin2.id, true);
    expect(rg.ok, rg.mensaje).toBe(true);
    expect(await cuentaActiva(admin2.id, empresaId)).toBe(true);
  });

  it("actualizarActivoUsuarioEnEmpresa: reactivar a quien nunca fue admin sigue sin restricción", async () => {
    const { empresaId, admin1, operador } = await armar();
    await actuarComo(admin1);
    const r = await actualizarActivoUsuarioEnEmpresa(operador.id, true);
    expect(r.ok, r.mensaje).toBe(true);
    expect(await cuentaActiva(operador.id, empresaId)).toBe(true);
  });

  it("actualizarActivoMembresia: un admin no reactiva la membresía admin de otro; el gerente sí", async () => {
    const { gerente, admin1, admin2 } = await armar();
    const membresia = await prismaAdmin.usuarioSucursal.findFirstOrThrow({ where: { usuarioId: admin2.id } });

    await actuarComo(admin1);
    const r = await actualizarActivoMembresia(membresia.id, true);
    expect(r.ok).toBe(false);
    expect(r.mensaje).toContain("gerente");
    expect((await prismaAdmin.usuarioSucursal.findUniqueOrThrow({ where: { id: membresia.id } })).activo).toBe(false);

    await actuarComo(gerente);
    const rg = await actualizarActivoMembresia(membresia.id, true);
    expect(rg.ok, rg.mensaje).toBe(true);
  });

  it("agregarOActualizarUsuario: no es una puerta de atrás para reactivar a un admin apagado (membresía ni cuenta)", async () => {
    const { base, empresaId, gerente, admin1, admin2 } = await armar();

    await actuarComo(admin1);
    const r = await agregarOActualizarUsuario({ email: admin2.email, rolId: base.admin.id, sucursalId: base.sucursal.id });
    expect(r.ok).toBe(false);
    expect(r.mensaje).toContain("gerente");
    expect(await cuentaActiva(admin2.id, empresaId)).toBe(false);
    expect((await prismaAdmin.usuarioSucursal.findFirstOrThrow({ where: { usuarioId: admin2.id } })).activo).toBe(false);

    // Sin ninguna membresía admin (cambió de rol), ya no es una reactivación de administrador.
    await prismaAdmin.usuarioSucursal.updateMany({ where: { usuarioId: admin2.id }, data: { rolId: base.operador.id } });
    const r2 = await agregarOActualizarUsuario({ email: admin2.email, rolId: base.operador.id, sucursalId: base.sucursal.id });
    expect(r2.ok).toBe(true); // ya no tiene el rol admin en ninguna membresía: es un operador más

    await actuarComo(gerente);
    await prismaAdmin.usuarioSucursal.updateMany({ where: { usuarioId: admin2.id }, data: { rolId: base.admin.id, activo: false } });
    await prismaAdmin.usuarioEmpresa.updateMany({ where: { usuarioId: admin2.id }, data: { activo: false } });
    const rg = await agregarOActualizarUsuario({ email: admin2.email, rolId: base.admin.id, sucursalId: base.sucursal.id });
    expect(rg.ok, rg.mensaje).toBe(true);
    expect(await cuentaActiva(admin2.id, empresaId)).toBe(true);
  });

  it("agregarOActualizarUsuario: dar de alta a un operador apagado no requiere al gerente", async () => {
    const { base, admin1, operador } = await armar();
    await actuarComo(admin1);
    const r = await agregarOActualizarUsuario({ email: operador.email, rolId: base.operador.id, sucursalId: base.sucursal.id });
    expect(r.ok, r.mensaje).toBe(true);
  });

  it("crearSucursalConAdmin: no reactiva por la puerta de atrás la cuenta apagada de un admin; el gerente sí", async () => {
    const { empresaId, gerente, admin1, admin2 } = await armar();

    await actuarComo(admin1);
    const r = await crearSucursalConAdmin({ nombre: "Nueva", emailPrimerAdmin: admin2.email });
    if (r.ok) throw new Error("debía rechazar");
    expect(r.mensaje).toContain("gerente");
    expect(await cuentaActiva(admin2.id, empresaId)).toBe(false);
    expect(await prismaAdmin.sucursal.count({ where: { nombre: "Nueva" } })).toBe(0);

    await actuarComo(gerente);
    const rg = await crearSucursalConAdmin({ nombre: "Nueva", emailPrimerAdmin: admin2.email });
    expect(rg.ok, rg.mensaje).toBe(true);
    expect(await cuentaActiva(admin2.id, empresaId)).toBe(true);
  });
});

describe("S-10: auditoría de altas, bajas y reactivaciones", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
  });

  async function armar() {
    const base = await sembrarBase();
    const empresaId = base.sucursal.empresaId;
    const gerente = await crearUsuarioConMembresia({ email: "gerente@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await hacerGerente(gerente.id, empresaId);
    await actuarComo(gerente);
    return { base, empresaId, gerente };
  }

  it("agregarOActualizarUsuario: un alta nueva deja la cuenta de empresa, el rol y el activo de la membresía en la sucursal", async () => {
    const { base, gerente } = await armar();

    const r = await agregarOActualizarUsuario({ email: "nuevo@test.com", rolId: base.operador.id, sucursalId: base.sucursal.id });
    expect(r.ok, r.mensaje).toBe(true);
    const nuevo = await prismaAdmin.user.findUniqueOrThrow({ where: { email: "nuevo@test.com" } });

    const cuentas = await auditoria("UsuarioEmpresa");
    expect(cuentas).toHaveLength(1);
    expect(cuentas[0]).toMatchObject({ entidadId: nuevo.id, campo: "activo", valorAnterior: null, valorNuevo: "true", sucursalId: null, actorId: gerente.id });

    const membresias = await auditoria("UsuarioSucursal");
    expect(membresias.map((f) => [f.campo, f.valorAnterior, f.valorNuevo, f.sucursalId])).toEqual([
      ["rol", null, "operador", base.sucursal.id],
      ["activo", null, "true", base.sucursal.id],
    ]);
  });

  it("agregarOActualizarUsuario: el cambio de rol de un usuario existente deja anterior y nuevo; sin cambios no escribe nada", async () => {
    const { base } = await armar();
    await agregarOActualizarUsuario({ email: "nuevo@test.com", rolId: base.operador.id, sucursalId: base.sucursal.id });
    const antes = await prismaAdmin.registroAuditoria.count();

    await agregarOActualizarUsuario({ email: "nuevo@test.com", rolId: base.operador.id, sucursalId: base.sucursal.id });
    expect(await prismaAdmin.registroAuditoria.count()).toBe(antes);

    await agregarOActualizarUsuario({ email: "nuevo@test.com", rolId: base.admin.id, sucursalId: base.sucursal.id });
    const rol = (await auditoria("UsuarioSucursal")).filter((f) => f.campo === "rol").at(-1)!;
    expect([rol.valorAnterior, rol.valorNuevo]).toEqual(["operador", "admin"]);
  });

  it("actualizarActivoMembresia y actualizarActivoUsuarioEnEmpresa: dejan la baja y la reactivación con anterior y nuevo", async () => {
    const { base, empresaId } = await armar();
    const op = await crearUsuarioConMembresia({ email: "op@test.com", sucursalId: base.sucursal.id, rolId: base.operador.id });
    const membresia = await prismaAdmin.usuarioSucursal.findFirstOrThrow({ where: { usuarioId: op.id } });

    await actualizarActivoMembresia(membresia.id, false);
    await actualizarActivoMembresia(membresia.id, true);
    expect((await auditoria("UsuarioSucursal")).map((f) => [f.entidadId, f.campo, f.valorAnterior, f.valorNuevo, f.sucursalId])).toEqual([
      [membresia.id, "activo", "true", "false", base.sucursal.id],
      [membresia.id, "activo", "false", "true", base.sucursal.id],
    ]);

    await actualizarActivoUsuarioEnEmpresa(op.id, false);
    await actualizarActivoUsuarioEnEmpresa(op.id, true);
    expect((await auditoria("UsuarioEmpresa")).map((f) => [f.entidadId, f.valorAnterior, f.valorNuevo, f.sucursalId])).toEqual([
      [op.id, "true", "false", null],
      [op.id, "false", "true", null],
    ]);
    void empresaId;
  });

  it("crearSucursalConAdmin: deja el alta de la sucursal, de la cuenta del primer admin y de su membresía", async () => {
    const { gerente } = await armar();

    const r = await crearSucursalConAdmin({ nombre: "Nueva", emailPrimerAdmin: "primer@test.com" });
    expect(r.ok, r.mensaje).toBe(true);
    const sucursal = await prismaAdmin.sucursal.findFirstOrThrow({ where: { nombre: "Nueva" } });
    const primer = await prismaAdmin.user.findUniqueOrThrow({ where: { email: "primer@test.com" } });

    expect(await auditoria("Sucursal")).toMatchObject([{ entidadId: sucursal.id, campo: "activo", valorAnterior: null, valorNuevo: "true", actorId: gerente.id }]);
    expect(await auditoria("UsuarioEmpresa")).toMatchObject([{ entidadId: primer.id, valorNuevo: "true" }]);
    expect(await auditoria("UsuarioSucursal")).toMatchObject([{ campo: "rol", valorNuevo: "admin", sucursalId: sucursal.id }]);
  });

  it("crearRol: deja el alta del rol (sin sucursal: es de la empresa)", async () => {
    const { gerente } = await armar();

    const r = await crearRol("Encargado");
    expect(r.ok, r.mensaje).toBe(true);
    const rol = await prismaAdmin.rol.findFirstOrThrow({ where: { nombre: "encargado" } });
    expect(await auditoria("Rol")).toMatchObject([{ entidadId: rol.id, campo: "nombre", valorAnterior: null, valorNuevo: "encargado", sucursalId: null, actorId: gerente.id }]);
  });
});
