import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { crearMembresia } from "../setup/membresia";
import { listarCandidatosAGerente, obtenerGerenteDeEmpresa, transferirGerenciaDeEmpresa } from "../../src/core/permisos/gerencia";
import {
  actualizarActivoMembresia,
  actualizarActivoUsuarioEnEmpresa,
  agregarOActualizarUsuario,
  transferirGerencia,
} from "../../src/server/actions/auth/usuarios";

/**
 * Una empresa tiene UN solo gerente (`UsuarioEmpresa.rolEmpresa = 'gerente'`): nunca queda sin gerente ni con dos, nadie más que él lo
 * modifica y la gerencia solo cambia de manos con un traspaso. La regla vive en el código y, desde S-13, también la hace cumplir la base (índice único parcial; ver test/persistencia/gerente-unico-indice.test.ts).
 */

const NORTE = "norte";

async function crearEmpresaNorte() {
  await prismaAdmin.empresa.create({
    data: { id: NORTE, nombre: "Norte", slug: "norte", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "ACTIVE" },
  });
  const sucursal = await prismaAdmin.sucursal.create({ data: { nombre: "Norte", empresaId: NORTE } });
  const admin = await prismaAdmin.rol.create({ data: { nombre: "admin", clave: "admin", empresaId: NORTE } });
  return { sucursal, admin };
}

const gerentes = (empresaId = EMPRESA_POR_DEFECTO_ID) => prismaAdmin.usuarioEmpresa.findMany({ where: { empresaId, rolEmpresa: "gerente" }, select: { usuarioId: true } });
const hacerGerente = (usuarioId: string, empresaId = EMPRESA_POR_DEFECTO_ID) =>
  prismaAdmin.usuarioEmpresa.update({ where: { usuarioId_empresaId: { usuarioId, empresaId } }, data: { rolEmpresa: "gerente" } });
const traspasar = (usuarioDestinoId: string, empresaId = EMPRESA_POR_DEFECTO_ID) =>
  prismaAdmin.$transaction((tx) => transferirGerenciaDeEmpresa(tx, { empresaId, usuarioDestinoId }));

describe("transferirGerenciaDeEmpresa", () => {
  let base: Awaited<ReturnType<typeof sembrarBase>>;
  let gerenteId: string;
  let adminId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    base = await sembrarBase();
    gerenteId = (await crearUsuarioConMembresia({ email: "gerente@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id })).id;
    adminId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id })).id;
    await hacerGerente(gerenteId);
  });

  it("el gerente actual deja de serlo y el destino lo es: sigue habiendo uno solo", async () => {
    const r = await traspasar(adminId);
    expect(r).toMatchObject({ ok: true, gerenteAnteriorId: gerenteId });
    expect((await gerentes()).map((g) => g.usuarioId)).toEqual([adminId]);
    expect((await obtenerGerenteDeEmpresa(prismaAdmin, EMPRESA_POR_DEFECTO_ID))?.usuarioId).toBe(adminId);
  });

  it("si la empresa no tiene gerente (dato viejo, o la plataforma lo asigna), lo nombra sin gerente anterior", async () => {
    await prismaAdmin.usuarioEmpresa.update({ where: { usuarioId_empresaId: { usuarioId: gerenteId, empresaId: EMPRESA_POR_DEFECTO_ID } }, data: { rolEmpresa: null } });
    const r = await traspasar(adminId);
    expect(r).toMatchObject({ ok: true, gerenteAnteriorId: null });
    expect((await gerentes()).map((g) => g.usuarioId)).toEqual([adminId]);
  });

  it("no se traspasa a quien ya es el gerente", async () => {
    const r = await traspasar(gerenteId);
    expect(r.ok).toBe(false);
    expect((await gerentes()).map((g) => g.usuarioId)).toEqual([gerenteId]);
  });

  it("el destino tiene que ser admin activo en alguna sucursal (no se salta el escalón)", async () => {
    const operador = await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId: base.sucursal.id, rolId: base.operador.id });
    expect((await traspasar(operador.id)).ok).toBe(false);

    await prismaAdmin.usuarioSucursal.updateMany({ where: { usuarioId: adminId }, data: { activo: false } });
    expect((await traspasar(adminId)).ok).toBe(false);
    expect((await gerentes()).map((g) => g.usuarioId)).toEqual([gerenteId]);
  });

  it("el destino tiene que tener la cuenta activa, en la empresa y en la plataforma", async () => {
    await prismaAdmin.usuarioEmpresa.update({ where: { usuarioId_empresaId: { usuarioId: adminId, empresaId: EMPRESA_POR_DEFECTO_ID } }, data: { activo: false } });
    expect((await traspasar(adminId)).ok).toBe(false);

    await prismaAdmin.usuarioEmpresa.update({ where: { usuarioId_empresaId: { usuarioId: adminId, empresaId: EMPRESA_POR_DEFECTO_ID } }, data: { activo: true } });
    await prismaAdmin.user.update({ where: { id: adminId }, data: { activoGlobal: false } });
    expect((await traspasar(adminId)).ok).toBe(false);
    expect((await gerentes()).map((g) => g.usuarioId)).toEqual([gerenteId]);
  });

  it("con dos empresas, el traspaso de una no toca al gerente de la otra ni acepta a alguien de la otra", async () => {
    const norte = await crearEmpresaNorte();
    const gerenteNorte = await crearUsuarioConMembresia({ email: "gerente-norte@test.com", sucursalId: norte.sucursal.id, rolId: norte.admin.id });
    const adminNorte = await crearUsuarioConMembresia({ email: "admin-norte@test.com", sucursalId: norte.sucursal.id, rolId: norte.admin.id });
    await hacerGerente(gerenteNorte.id, NORTE);

    expect((await traspasar(adminNorte.id, EMPRESA_POR_DEFECTO_ID)).ok).toBe(false);
    expect((await traspasar(adminId)).ok).toBe(true);

    expect((await gerentes()).map((g) => g.usuarioId)).toEqual([adminId]);
    expect((await gerentes(NORTE)).map((g) => g.usuarioId)).toEqual([gerenteNorte.id]);
  });

  it("dos traspasos que parten del mismo gerente no se aplican los dos: el segundo ve que la gerencia cambió", async () => {
    const otroAdmin = await crearUsuarioConMembresia({ email: "otro-admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
    let liberar!: () => void;
    const puerta = new Promise<void>((r) => (liberar = r));

    // El primero escribe y deja su transacción abierta; el segundo lee al MISMO gerente (el cambio no está confirmado) y queda esperando su baja.
    const primero = prismaAdmin.$transaction(async (tx) => {
      const r = await transferirGerenciaDeEmpresa(tx, { empresaId: EMPRESA_POR_DEFECTO_ID, usuarioDestinoId: adminId });
      await puerta;
      return r;
    });
    await espera(500);
    const segundo = traspasar(otroAdmin.id);
    await espera(500);
    liberar();
    const [r1, r2] = await Promise.all([primero, segundo]);

    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(false);
    expect((await gerentes()).map((g) => g.usuarioId)).toEqual([adminId]);
  });
});

describe("el gerente está por encima del admin: nadie más lo toca", () => {
  let base: Awaited<ReturnType<typeof sembrarBase>>;
  let gerenteId: string;
  let adminId: string;
  let otraSucursalId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    base = await sembrarBase();
    otraSucursalId = (await prisma.sucursal.create({ data: { nombre: "Otra sucursal" } })).id;
    gerenteId = (await crearUsuarioConMembresia({ email: "gerente@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id })).id;
    adminId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id })).id;
    await hacerGerente(gerenteId);
  });

  const actuarComo = async (id: string, email: string) => mockearUsuarioActual({ id, email, nombre: null });
  const membresiaDe = (usuarioId: string, sucursalId = base.sucursal.id) => prisma.usuarioSucursal.findFirstOrThrow({ where: { usuarioId, sucursalId } });

  it("un admin que no es gerente no puede desactivar la cuenta del gerente, ni su membresía, ni cambiarle el rol", async () => {
    await actuarComo(adminId, "admin@test.com");

    const cuenta = await actualizarActivoUsuarioEnEmpresa(gerenteId, false);
    expect(cuenta.ok).toBe(false);
    expect(cuenta.mensaje).toMatch(/gerente/);
    expect((await prisma.usuarioEmpresa.findFirstOrThrow({ where: { usuarioId: gerenteId } })).activo).toBe(true);

    const membresia = await actualizarActivoMembresia((await membresiaDe(gerenteId)).id, false);
    expect(membresia.ok).toBe(false);
    expect((await membresiaDe(gerenteId)).activo).toBe(true);

    const rol = await agregarOActualizarUsuario({ email: "gerente@test.com", sucursalId: base.sucursal.id, rolId: base.operador.id });
    expect(rol.ok).toBe(false);
    expect((await membresiaDe(gerenteId)).rolId).toBe(base.admin.id);
  });

  it("el gerente no puede desactivar su propia cuenta en la empresa", async () => {
    await actuarComo(gerenteId, "gerente@test.com");
    const r = await actualizarActivoUsuarioEnEmpresa(gerenteId, false);
    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/traspas/);
    expect((await prisma.usuarioEmpresa.findFirstOrThrow({ where: { usuarioId: gerenteId } })).activo).toBe(true);
  });

  it("el gerente no puede quedarse sin ninguna sucursal activa, pero sí desactivar una si le queda otra", async () => {
    await actuarComo(gerenteId, "gerente@test.com");
    const unica = await actualizarActivoMembresia((await membresiaDe(gerenteId)).id, false);
    expect(unica.ok).toBe(false);
    expect(unica.mensaje).toMatch(/gerente/);
    expect((await membresiaDe(gerenteId)).activo).toBe(true);

    await crearMembresia({ usuarioId: gerenteId, sucursalId: otraSucursalId, rolId: base.admin.id, activo: true });
    const conOtra = await actualizarActivoMembresia((await membresiaDe(gerenteId)).id, false);
    expect(conOtra.ok, conOtra.mensaje).toBe(true);
  });

  it("una vez traspasada la gerencia, quien dejó de ser gerente ya es un admin común (se lo puede desactivar)", async () => {
    await actuarComo(gerenteId, "gerente@test.com");
    expect((await transferirGerencia(adminId, "admin@test.com")).ok).toBe(true);

    await actuarComo(adminId, "admin@test.com");
    const r = await actualizarActivoUsuarioEnEmpresa(gerenteId, false);
    expect(r.ok, r.mensaje).toBe(true);
  });
});

describe("listarCandidatosAGerente", () => {
  it("ofrece solo a los administradores activos de la empresa que no son el gerente (cuenta y pertenencia activas)", async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    const gerente = await crearUsuarioConMembresia({ email: "gerente@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    const admin = await crearUsuarioConMembresia({ email: "b-admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId: base.sucursal.id, rolId: base.operador.id });
    const apagado = await crearUsuarioConMembresia({ email: "apagado@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    const sinCuenta = await crearUsuarioConMembresia({ email: "sin-cuenta@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await hacerGerente(gerente.id);
    await prismaAdmin.usuarioEmpresa.update({ where: { usuarioId_empresaId: { usuarioId: apagado.id, empresaId: EMPRESA_POR_DEFECTO_ID } }, data: { activo: false } });
    await prismaAdmin.user.update({ where: { id: sinCuenta.id }, data: { activoGlobal: false } });

    const candidatos = await listarCandidatosAGerente(prismaAdmin, EMPRESA_POR_DEFECTO_ID);
    expect(candidatos.map((c) => c.email)).toEqual(["b-admin@test.com"]);
    expect(candidatos[0].id).toBe(admin.id);
    // Sin gerente (dato viejo): todos los admins activos son candidatos.
    await prismaAdmin.usuarioEmpresa.update({ where: { usuarioId_empresaId: { usuarioId: gerente.id, empresaId: EMPRESA_POR_DEFECTO_ID } }, data: { rolEmpresa: null } });
    expect((await listarCandidatosAGerente(prismaAdmin, EMPRESA_POR_DEFECTO_ID)).map((c) => c.email)).toEqual(["b-admin@test.com", "gerente@test.com"]);
  });
});

describe("transferirGerencia (la acción)", () => {
  let base: Awaited<ReturnType<typeof sembrarBase>>;
  let gerenteId: string;
  let adminId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    base = await sembrarBase();
    gerenteId = (await crearUsuarioConMembresia({ email: "gerente@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id })).id;
    adminId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id })).id;
    await hacerGerente(gerenteId);
  });

  it("el gerente traspasa la gerencia a un admin y queda en la auditoría de la empresa", async () => {
    await mockearUsuarioActual({ id: gerenteId, email: "gerente@test.com", nombre: null });
    const r = await transferirGerencia(adminId, "admin@test.com");
    expect(r.ok, r.mensaje).toBe(true);

    expect((await gerentes()).map((g) => g.usuarioId)).toEqual([adminId]);
    const registros = await prisma.registroAuditoria.findMany({ where: { entidad: "UsuarioEmpresa" } });
    expect(registros).toHaveLength(1);
    expect(registros[0]).toMatchObject({ entidadId: adminId, campo: "rolEmpresa", actorId: gerenteId, sucursalId: null, valorAnterior: "gerente@test.com", valorNuevo: "admin@test.com" });
  });

  it("sin el email correcto de la persona elegida no se traspasa nada ni queda rastro en la auditoría", async () => {
    await mockearUsuarioActual({ id: gerenteId, email: "gerente@test.com", nombre: null });
    for (const tipeado of ["", "otro@test.com", "gerente@test.com"]) {
      const r = await transferirGerencia(adminId, tipeado);
      expect(r.ok, tipeado).toBe(false);
      expect(r.mensaje).toMatch(/email/);
    }
    expect((await gerentes()).map((g) => g.usuarioId)).toEqual([gerenteId]);
    expect(await prisma.registroAuditoria.count({ where: { entidad: "UsuarioEmpresa" } })).toBe(0);
  });

  it("el email confirmado se compara sin espacios ni mayúsculas", async () => {
    await mockearUsuarioActual({ id: gerenteId, email: "gerente@test.com", nombre: null });
    const r = await transferirGerencia(adminId, "  Admin@Test.COM ");
    expect(r.ok, r.mensaje).toBe(true);
    expect((await gerentes()).map((g) => g.usuarioId)).toEqual([adminId]);
  });

  it("un destino que no es de la empresa se rechaza", async () => {
    await mockearUsuarioActual({ id: gerenteId, email: "gerente@test.com", nombre: null });
    const r = await transferirGerencia("no-existe", "x@test.com");
    expect(r.ok).toBe(false);
    expect((await gerentes()).map((g) => g.usuarioId)).toEqual([gerenteId]);
  });

  it("un admin que no es gerente no puede pedir el traspaso, ni a sí mismo", async () => {
    await mockearUsuarioActual({ id: adminId, email: "admin@test.com", nombre: null });
    const r = await transferirGerencia(adminId, "admin@test.com");
    expect(r.ok).toBe(false);
    expect((await gerentes()).map((g) => g.usuarioId)).toEqual([gerenteId]);
    expect(await prisma.registroAuditoria.count({ where: { entidad: "UsuarioEmpresa" } })).toBe(0);
  });

  it("un destino que no corresponde no cambia nada ni deja rastro en la auditoría", async () => {
    const operador = await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId: base.sucursal.id, rolId: base.operador.id });
    await mockearUsuarioActual({ id: gerenteId, email: "gerente@test.com", nombre: null });
    const r = await transferirGerencia(operador.id, "operador@test.com");
    expect(r.ok).toBe(false);
    expect((await gerentes()).map((g) => g.usuarioId)).toEqual([gerenteId]);
    expect(await prisma.registroAuditoria.count({ where: { entidad: "UsuarioEmpresa" } })).toBe(0);
  });
});
