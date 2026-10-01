import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, prisma, prismaAdmin } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { crearMembresia } from "../setup/membresia";
import { agregarOActualizarUsuario, actualizarActivoMembresia, actualizarActivoUsuarioEnEmpresa } from "../../src/server/actions/auth/usuarios";

/**
 * Alcance de la gestión de usuarios: `conPermiso("gestion_usuarios")` solo mira la sucursal ACTIVA y `User`/`UsuarioEmpresa` son
 * tablas sin RLS, así que cada acción tiene que acotar por su cuenta a qué sucursal/empresa apunta.
 */

async function crearEmpresaAjena() {
  await prismaAdmin.empresa.create({
    data: { id: "otra", nombre: "Otra", slug: "otra", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "ACTIVE" },
  });
  const sucursal = await prismaAdmin.sucursal.create({ data: { nombre: "Ajena", empresaId: "otra" } });
  const admin = await prismaAdmin.rol.create({ data: { nombre: "admin", empresaId: "otra" } });
  const operador = await prismaAdmin.rol.create({ data: { nombre: "operador", empresaId: "otra" } });
  return { sucursal, admin, operador };
}

function pertenencia(usuarioId: string, empresaId: string) {
  return prismaAdmin.usuarioEmpresa.findUniqueOrThrow({ where: { usuarioId_empresaId: { usuarioId, empresaId } } });
}

describe("actualizarActivoUsuarioEnEmpresa: alcance de empresa", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
  });

  it("no apaga la cuenta de un usuario que solo pertenece a OTRA empresa", async () => {
    const base = await sembrarBase();
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    const ajena = await crearEmpresaAjena();
    const victima = await prismaAdmin.user.create({ data: { email: "victima@otra.com" } });
    await crearMembresia({ usuarioId: victima.id, sucursalId: ajena.sucursal.id, rolId: ajena.operador.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });

    const resultado = await actualizarActivoUsuarioEnEmpresa(victima.id, false);
    expect(resultado.ok).toBe(false);
    expect((await pertenencia(victima.id, "otra")).activo).toBe(true);
    expect((await prismaAdmin.user.findUniqueOrThrow({ where: { id: victima.id } })).activoGlobal).toBe(true);
  });

  it("tampoco reactiva la cuenta de un usuario de otra empresa", async () => {
    const base = await sembrarBase();
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    const ajena = await crearEmpresaAjena();
    const victima = await prismaAdmin.user.create({ data: { email: "victima@otra.com" } });
    await crearMembresia({ usuarioId: victima.id, sucursalId: ajena.sucursal.id, rolId: ajena.operador.id });
    await prismaAdmin.usuarioEmpresa.update({ where: { usuarioId_empresaId: { usuarioId: victima.id, empresaId: "otra" } }, data: { activo: false } });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });

    const resultado = await actualizarActivoUsuarioEnEmpresa(victima.id, true);
    expect(resultado.ok).toBe(false);
    expect((await pertenencia(victima.id, "otra")).activo).toBe(false);
  });

  it("una cuenta compartida con otra empresa se apaga SOLO acá: la otra empresa y la cuenta de plataforma siguen activas", async () => {
    const base = await sembrarBase();
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    const ajena = await crearEmpresaAjena();
    const compartido = await crearUsuarioConMembresia({ email: "compartido@test.com", sucursalId: base.sucursal.id, rolId: base.operador.id });
    await crearMembresia({ usuarioId: compartido.id, sucursalId: ajena.sucursal.id, rolId: ajena.operador.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });

    const resultado = await actualizarActivoUsuarioEnEmpresa(compartido.id, false);
    expect(resultado.ok, resultado.mensaje).toBe(true);
    expect((await pertenencia(compartido.id, base.sucursal.empresaId)).activo).toBe(false);
    expect((await pertenencia(compartido.id, "otra")).activo).toBe(true);
    expect((await prismaAdmin.user.findUniqueOrThrow({ where: { id: compartido.id } })).activoGlobal).toBe(true);
  });

  it("un id que no existe da el mismo mensaje que uno de otra empresa (no revela si existe)", async () => {
    const base = await sembrarBase();
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });

    const inexistente = await actualizarActivoUsuarioEnEmpresa("no-existe", false);
    const ajena = await crearEmpresaAjena();
    const victima = await prismaAdmin.user.create({ data: { email: "victima@otra.com" } });
    await crearMembresia({ usuarioId: victima.id, sucursalId: ajena.sucursal.id, rolId: ajena.operador.id });
    const deOtraEmpresa = await actualizarActivoUsuarioEnEmpresa(victima.id, false);

    expect(deOtraEmpresa.mensaje).toBe(inexistente.mensaje);
  });
});

describe("agregarOActualizarUsuario: alcance de sucursal y de rol", () => {
  async function escenario() {
    const base = await sembrarBase();
    const sucursalB = await prisma.sucursal.create({ data: { nombre: "Sucursal B" } });
    // Gerente de sucursal: puede gestionar usuarios (pero no es admin).
    const gerente = await prisma.rol.create({ data: { nombre: "gerente" } });
    await prisma.permisoRol.create({ data: { rolId: gerente.id, accionClave: "gestion_usuarios", puedeEditar: true, puedeVer: true } });
    return { base, sucursalB, gerente };
  }

  beforeEach(async () => {
    await limpiarBaseDeTest();
  });

  it("no da de alta en una sucursal donde quien lo hace NO tiene gestion_usuarios (admin en una, operador en la otra)", async () => {
    const { base, sucursalB } = await escenario();
    const actor = await crearUsuarioConMembresia({ email: "actor@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await crearMembresia({ usuarioId: actor.id, sucursalId: sucursalB.id, rolId: base.operador.id });
    await mockearUsuarioActual({ id: actor.id, email: actor.email, nombre: null });

    const resultado = await agregarOActualizarUsuario({ email: "nuevo@test.com", sucursalId: sucursalB.id, rolId: base.operador.id });
    expect(resultado.ok).toBe(false);
    expect(await prisma.usuarioSucursal.count({ where: { sucursalId: sucursalB.id, usuario: { email: "nuevo@test.com" } } })).toBe(0);
  });

  it("no da de alta en una sucursal donde quien lo hace ni siquiera tiene membresía", async () => {
    const { base, sucursalB } = await escenario();
    const actor = await crearUsuarioConMembresia({ email: "actor@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await mockearUsuarioActual({ id: actor.id, email: actor.email, nombre: null });

    const resultado = await agregarOActualizarUsuario({ email: "nuevo@test.com", sucursalId: sucursalB.id, rolId: base.operador.id });
    expect(resultado.ok).toBe(false);
    expect(await prisma.usuarioSucursal.count({ where: { sucursalId: sucursalB.id } })).toBe(0);
  });

  it("sí da de alta en otra sucursal cuando allí también tiene gestion_usuarios", async () => {
    const { base, sucursalB } = await escenario();
    const actor = await crearUsuarioConMembresia({ email: "actor@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await crearMembresia({ usuarioId: actor.id, sucursalId: sucursalB.id, rolId: base.admin.id });
    await mockearUsuarioActual({ id: actor.id, email: actor.email, nombre: null });

    const resultado = await agregarOActualizarUsuario({ email: "nuevo@test.com", sucursalId: sucursalB.id, rolId: base.operador.id });
    expect(resultado.ok, resultado.mensaje).toBe(true);
    expect(await prisma.usuarioSucursal.count({ where: { sucursalId: sucursalB.id, usuario: { email: "nuevo@test.com" } } })).toBe(1);
  });

  it("quien no es admin ni gerente de empresa no puede dar el rol admin (escalada de privilegios), ni a otro ni a sí mismo", async () => {
    const { base, gerente } = await escenario();
    const actor = await crearUsuarioConMembresia({ email: "gerente@test.com", sucursalId: base.sucursal.id, rolId: gerente.id });
    await mockearUsuarioActual({ id: actor.id, email: actor.email, nombre: null });

    const aOtro = await agregarOActualizarUsuario({ email: "otro@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    expect(aOtro.ok).toBe(false);
    const aSiMismo = await agregarOActualizarUsuario({ email: actor.email, sucursalId: base.sucursal.id, rolId: base.admin.id });
    expect(aSiMismo.ok).toBe(false);

    expect(await prisma.usuarioSucursal.count({ where: { rolId: base.admin.id } })).toBe(0);
    expect((await prisma.usuarioSucursal.findFirstOrThrow({ where: { usuarioId: actor.id } })).rolId).toBe(gerente.id);
  });

  it("quien no es admin ni gerente de empresa no puede degradar/cambiar la membresía de un admin", async () => {
    const { base, gerente } = await escenario();
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    const actor = await crearUsuarioConMembresia({ email: "gerente@test.com", sucursalId: base.sucursal.id, rolId: gerente.id });
    await mockearUsuarioActual({ id: actor.id, email: actor.email, nombre: null });

    const resultado = await agregarOActualizarUsuario({ email: admin.email, sucursalId: base.sucursal.id, rolId: base.operador.id });
    expect(resultado.ok).toBe(false);
    expect((await prisma.usuarioSucursal.findFirstOrThrow({ where: { usuarioId: admin.id } })).rolId).toBe(base.admin.id);
  });

  it("un admin sí puede dar roles que no son admin", async () => {
    const { base } = await escenario();
    const actor = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await mockearUsuarioActual({ id: actor.id, email: actor.email, nombre: null });

    const resultado = await agregarOActualizarUsuario({ email: "nuevo@test.com", sucursalId: base.sucursal.id, rolId: base.operador.id });
    expect(resultado.ok, resultado.mensaje).toBe(true);
  });

  it("un admin sí puede dar el rol admin", async () => {
    const { base } = await escenario();
    const actor = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await mockearUsuarioActual({ id: actor.id, email: actor.email, nombre: null });

    const resultado = await agregarOActualizarUsuario({ email: "otro-admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    expect(resultado.ok, resultado.mensaje).toBe(true);
  });

  // Gestionar usuarios es una acción de piso administrador: el rol de sucursal de quien la usa tiene que ser admin (un rol personalizado no la puede tener).
  it("el gerente de la empresa (rolEmpresa, con rol admin en la sucursal) puede dar el rol admin", async () => {
    const { base } = await escenario();
    const actor = await crearUsuarioConMembresia({ email: "gerente@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await prismaAdmin.usuarioEmpresa.update({
      where: { usuarioId_empresaId: { usuarioId: actor.id, empresaId: base.sucursal.empresaId } },
      data: { rolEmpresa: "gerente" },
    });
    await mockearUsuarioActual({ id: actor.id, email: actor.email, nombre: null });

    const resultado = await agregarOActualizarUsuario({ email: "nuevo-admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    expect(resultado.ok, resultado.mensaje).toBe(true);
  });
});

describe("desactivar a un admin: mismo techo de privilegio", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
  });

  async function escenario() {
    const base = await sembrarBase();
    const gerente = await prisma.rol.create({ data: { nombre: "gerente" } });
    await prisma.permisoRol.create({ data: { rolId: gerente.id, accionClave: "gestion_usuarios", puedeEditar: true, puedeVer: true } });
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    const otroAdmin = await crearUsuarioConMembresia({ email: "admin2@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    const actor = await crearUsuarioConMembresia({ email: "gerente@test.com", sucursalId: base.sucursal.id, rolId: gerente.id });
    return { base, admin, otroAdmin, actor };
  }

  it("quien no es admin ni gerente de empresa no puede desactivar la membresía de un admin", async () => {
    const { base, admin, actor } = await escenario();
    await mockearUsuarioActual({ id: actor.id, email: actor.email, nombre: null });
    const membresia = await prisma.usuarioSucursal.findFirstOrThrow({ where: { usuarioId: admin.id, sucursalId: base.sucursal.id } });

    const resultado = await actualizarActivoMembresia(membresia.id, false);
    expect(resultado.ok).toBe(false);
    expect((await prisma.usuarioSucursal.findUniqueOrThrow({ where: { id: membresia.id } })).activo).toBe(true);
  });

  it("quien no es admin ni gerente de empresa no puede apagar la cuenta de un admin en la empresa", async () => {
    const { base, admin, actor } = await escenario();
    await mockearUsuarioActual({ id: actor.id, email: actor.email, nombre: null });

    const resultado = await actualizarActivoUsuarioEnEmpresa(admin.id, false);
    expect(resultado.ok).toBe(false);
    expect((await pertenencia(admin.id, base.sucursal.empresaId)).activo).toBe(true);
  });

  it("el gerente de la empresa (con rol admin en la sucursal) sí puede apagar la cuenta de un admin si queda otro admin activo", async () => {
    const { base, admin, actor } = await escenario();
    await prismaAdmin.usuarioSucursal.updateMany({ where: { usuarioId: actor.id }, data: { rolId: base.admin.id } });
    await prismaAdmin.usuarioEmpresa.update({
      where: { usuarioId_empresaId: { usuarioId: actor.id, empresaId: base.sucursal.empresaId } },
      data: { rolEmpresa: "gerente" },
    });
    await mockearUsuarioActual({ id: actor.id, email: actor.email, nombre: null });

    const resultado = await actualizarActivoUsuarioEnEmpresa(admin.id, false);
    expect(resultado.ok, resultado.mensaje).toBe(true);
    expect((await pertenencia(admin.id, base.sucursal.empresaId)).activo).toBe(false);
  });
});
