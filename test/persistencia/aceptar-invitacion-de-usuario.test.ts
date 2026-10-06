import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, prismaAdmin } from "../setup/test-db";
import { aceptarInvitacionDeUsuarioDelToken } from "../../src/core/auth/invitacion";
import { MENSAJE_ENLACE_NO_VALIDO } from "../../src/core/features/empresa/aceptar-invitacion";
import { asegurarInvitacionDeUsuario, rotarInvitacionPendiente } from "../../src/core/features/empresa/invitacion-de-usuario";
import { sembrarEmpresa } from "../../src/core/features/empresa/sembrar-empresa";
import { incorporarPrimerGerente } from "../../src/core/permisos/gerencia";

/**
 * E8 (ADR-024): aceptar una invitación de USUARIO contra Postgres real, como `motor2_app` bajo la empresa de la invitación. Las membresías nacen recién acá y se REVALIDA, por cada
 * sucursal, el permiso y el techo de quien la otorgó. Todo o nada.
 */
const E = "empresa-usuarios";
const EMAIL = "nueva-persona@gmail.com";
const AHORA = new Date();
let gerenteId: string;
let sucursal1: string;
let sucursal2: string;
let rolAdmin: string;
let rolOperador: string;
let n = 0;
const token = () => `T${String(++n).padStart(2, "0")}${"q".repeat(40)}`;

beforeEach(async () => {
  await limpiarBaseDeTest();
  n = 0;
  await prismaAdmin.empresa.create({ data: { id: E, nombre: "Empresa usuarios", slug: "empresa-usuarios", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "ACTIVE" } });
  await prismaAdmin.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.empresa_id', ${E}, true)`;
    await sembrarEmpresa(tx, E, "Central");
  });
  gerenteId = (await prismaAdmin.user.create({ data: { email: "gerente@gmail.com" } })).id;
  await prismaAdmin.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.empresa_id', ${E}, true)`;
    await incorporarPrimerGerente(tx, { empresaId: E, usuarioId: gerenteId });
  });
  sucursal1 = (await prismaAdmin.sucursal.findFirstOrThrow({ where: { empresaId: E } })).id;
  rolAdmin = (await prismaAdmin.rol.findFirstOrThrow({ where: { empresaId: E, clave: "admin" } })).id;
  rolOperador = (await prismaAdmin.rol.findFirstOrThrow({ where: { empresaId: E, clave: "operador" } })).id;
  sucursal2 = (await prismaAdmin.sucursal.create({ data: { empresaId: E, nombre: "Norte" } })).id;
  await prismaAdmin.usuarioSucursal.create({ data: { usuarioId: gerenteId, sucursalId: sucursal2, empresaId: E, rolId: rolAdmin } });
});

afterAll(async () => {
  await limpiarBaseDeTest();
  await prismaAdmin.$disconnect();
});

/** Un administrador que NO es el gerente: tiene el rol admin en la sucursal 1 (y por eso `gestion_usuarios`). */
async function segundoAdmin() {
  const u = await prismaAdmin.user.create({ data: { email: "admin2@gmail.com" } });
  await prismaAdmin.usuarioEmpresa.create({ data: { usuarioId: u.id, empresaId: E } });
  await prismaAdmin.usuarioSucursal.create({ data: { usuarioId: u.id, sucursalId: sucursal1, empresaId: E, rolId: rolAdmin } });
  return u.id;
}

/** Invita como lo hace la acción: la invitación con una fila por sucursal, firmada por `invitador`. */
async function invitar(accesos: Array<{ sucursalId: string; rolId: string }>, invitador = gerenteId, email = EMAIL) {
  let resultado: Awaited<ReturnType<typeof asegurarInvitacionDeUsuario>> | undefined;
  for (const acceso of accesos) {
    resultado = await prismaAdmin.$transaction((tx) => asegurarInvitacionDeUsuario(tx, { empresaId: E, email, invitadoPorId: invitador, acceso, ahora: AHORA, generarToken: token }));
  }
  const primero = await prismaAdmin.invitacion.findFirstOrThrow({ where: { email, estado: "PENDIENTE" } });
  const ultimoToken = resultado && resultado.ok && resultado.token ? resultado.token : null;
  return { invitacionId: primero.id, token: ultimoToken ?? `T01${"q".repeat(40)}` };
}

const aceptar = async (t: string, email = EMAIL) => {
  const u = await prismaAdmin.user.upsert({ where: { email }, update: {}, create: { email } });
  return aceptarInvitacionDeUsuarioDelToken({ token: t, usuario: { id: u.id, email } });
};

const membresias = (email = EMAIL) => prismaAdmin.usuarioSucursal.findMany({ where: { usuario: { email } }, orderBy: { creadoEn: "asc" } });
const sinCambios = async (invitacionId: string) => {
  expect(await membresias()).toHaveLength(0);
  expect(await prismaAdmin.usuarioEmpresa.count({ where: { usuario: { email: EMAIL } } })).toBe(0);
  expect((await prismaAdmin.invitacion.findUniqueOrThrow({ where: { id: invitacionId } })).estado).toBe("PENDIENTE");
};

describe("aceptar una invitación de usuario", () => {
  it("crea la cuenta en la empresa y una membresía por sucursal con su rol, marca la invitación ACEPTADA y audita con quien otorgó como actor", async () => {
    const inv = await invitar([{ sucursalId: sucursal1, rolId: rolOperador }, { sucursalId: sucursal2, rolId: rolAdmin }]);
    const r = await aceptar(inv.token);
    expect(r).toMatchObject({ ok: true, empresaId: E, nombreEmpresa: "Empresa usuarios" });
    expect((await membresias()).map((m) => [m.sucursalId, m.rolId, m.activo])).toEqual([[sucursal1, rolOperador, true], [sucursal2, rolAdmin, true]]);
    expect(await prismaAdmin.usuarioEmpresa.findFirstOrThrow({ where: { usuario: { email: EMAIL }, empresaId: E } })).toMatchObject({ activo: true });
    expect(await prismaAdmin.invitacion.findUniqueOrThrow({ where: { id: inv.invitacionId } })).toMatchObject({ estado: "ACEPTADA" });
    const auditoria = await prismaAdmin.registroAuditoria.findMany({ where: { entidad: { in: ["UsuarioSucursal", "UsuarioEmpresa"] }, descripcion: { contains: EMAIL } } });
    expect(auditoria.length).toBeGreaterThanOrEqual(3);
    expect(new Set(auditoria.map((a) => a.actorId))).toEqual(new Set([gerenteId]));
  });

  it("un segundo uso del mismo enlace no hace nada", async () => {
    const inv = await invitar([{ sucursalId: sucursal1, rolId: rolOperador }]);
    expect((await aceptar(inv.token)).ok).toBe(true);
    expect(await aceptar(inv.token)).toEqual({ ok: false, mensaje: MENSAJE_ENLACE_NO_VALIDO });
    expect(await membresias()).toHaveLength(1);
  });

  it("dos aceptaciones a la vez: una sola gana y las membresías se crean una vez", async () => {
    const inv = await invitar([{ sucursalId: sucursal1, rolId: rolOperador }]);
    const u = await prismaAdmin.user.create({ data: { email: EMAIL } });
    const una = () => aceptarInvitacionDeUsuarioDelToken({ token: inv.token, usuario: { id: u.id, email: EMAIL } });
    const resultados = await Promise.all([una(), una()]);
    expect(resultados.filter((r) => r.ok)).toHaveLength(1);
    expect(await membresias()).toHaveLength(1);
  });

  it("rechaza un enlace de otro email, vencido, revocado o inventado", async () => {
    const inv = await invitar([{ sucursalId: sucursal1, rolId: rolOperador }]);
    expect((await aceptar(inv.token, "otra-persona@gmail.com")).ok).toBe(false);
    expect(await aceptar("x".repeat(43))).toEqual({ ok: false, mensaje: MENSAJE_ENLACE_NO_VALIDO });
    await prismaAdmin.invitacion.update({ where: { id: inv.invitacionId }, data: { venceEn: new Date(Date.now() - 1000) } });
    expect(await aceptar(inv.token)).toEqual({ ok: false, mensaje: MENSAJE_ENLACE_NO_VALIDO });
    await prismaAdmin.invitacion.update({ where: { id: inv.invitacionId }, data: { venceEn: new Date(Date.now() + 3_600_000), estado: "REVOCADA", revocadaEn: new Date() } });
    expect(await aceptar(inv.token)).toEqual({ ok: false, mensaje: MENSAJE_ENLACE_NO_VALIDO });
    expect(await membresias()).toHaveLength(0);
  });

  it("no acepta si la empresa está suspendida", async () => {
    const inv = await invitar([{ sucursalId: sucursal1, rolId: rolOperador }]);
    await prismaAdmin.empresa.update({ where: { id: E }, data: { estado: "SUSPENDED" } });
    expect(await aceptar(inv.token)).toEqual({ ok: false, mensaje: MENSAJE_ENLACE_NO_VALIDO });
    await sinCambios(inv.invitacionId);
  });
});

describe("se revalida al aceptar lo que valía al invitar: todo o nada", () => {
  it("quien otorgó perdió su membresía en una de las sucursales: no se crea NADA, ni siquiera la otra", async () => {
    const inv = await invitar([{ sucursalId: sucursal1, rolId: rolOperador }, { sucursalId: sucursal2, rolId: rolOperador }]);
    await prismaAdmin.usuarioSucursal.updateMany({ where: { usuarioId: gerenteId, sucursalId: sucursal2 }, data: { activo: false } });
    const r = await aceptar(inv.token);
    expect(r).toMatchObject({ ok: false });
    expect(r.ok === false && r.mensaje).toContain("Norte");
    await sinCambios(inv.invitacionId);
  });

  it("quien otorgó perdió el permiso gestion_usuarios en esa sucursal (se lo sacaron al rol admin)", async () => {
    const admin2 = await segundoAdmin();
    const inv = await invitar([{ sucursalId: sucursal1, rolId: rolOperador }], admin2);
    await prismaAdmin.permisoRol.updateMany({ where: { rolId: rolAdmin, accionClave: "gestion_usuarios" }, data: { puedeEditar: false } });
    expect((await aceptar(inv.token)).ok).toBe(false);
    await sinCambios(inv.invitacionId);
  });

  it("el techo: un administrador que no es el gerente no puede incorporar al gerente de la empresa, aunque la invitación lo traiga", async () => {
    const admin2 = await segundoAdmin();
    const inv = await invitar([{ sucursalId: sucursal1, rolId: rolOperador }], admin2, "gerente@gmail.com");
    const r = await aceptar(inv.token, "gerente@gmail.com");
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.mensaje).toContain("gerente");
    expect((await prismaAdmin.invitacion.findUniqueOrThrow({ where: { id: inv.invitacionId } })).estado).toBe("PENDIENTE");
  });

  it("quien otorgó tiene la cuenta apagada en la empresa o en toda la plataforma", async () => {
    const inv = await invitar([{ sucursalId: sucursal1, rolId: rolOperador }]);
    await prismaAdmin.usuarioEmpresa.updateMany({ where: { usuarioId: gerenteId, empresaId: E }, data: { activo: false } });
    expect((await aceptar(inv.token)).ok).toBe(false);
    await prismaAdmin.usuarioEmpresa.updateMany({ where: { usuarioId: gerenteId, empresaId: E }, data: { activo: true } });
    await prismaAdmin.user.update({ where: { id: gerenteId }, data: { activoGlobal: false } });
    expect((await aceptar(inv.token)).ok).toBe(false);
    await sinCambios(inv.invitacionId);
  });

  it("la sucursal o el rol se desactivaron", async () => {
    const inv = await invitar([{ sucursalId: sucursal1, rolId: rolOperador }, { sucursalId: sucursal2, rolId: rolOperador }]);
    await prismaAdmin.sucursal.update({ where: { id: sucursal2 }, data: { activo: false } });
    expect((await aceptar(inv.token)).ok).toBe(false);
    await prismaAdmin.sucursal.update({ where: { id: sucursal2 }, data: { activo: true } });
    await prismaAdmin.rol.update({ where: { id: rolOperador }, data: { activo: false } });
    expect((await aceptar(inv.token)).ok).toBe(false);
    await prismaAdmin.rol.update({ where: { id: rolOperador }, data: { activo: true } });
    await sinCambios(inv.invitacionId);
  });

  it("reenviar a nombre de otra persona que sí puede otorgar vuelve a firmar la invitación, y entonces se acepta", async () => {
    const admin2 = await segundoAdmin();
    const inv = await invitar([{ sucursalId: sucursal1, rolId: rolOperador }], admin2);
    await prismaAdmin.usuarioSucursal.updateMany({ where: { usuarioId: admin2 }, data: { activo: false } });
    expect((await aceptar(inv.token)).ok).toBe(false);
    const nuevo = await prismaAdmin.$transaction((tx) => rotarInvitacionPendiente(tx, { empresaId: E, invitacionId: inv.invitacionId, actorId: gerenteId, ahora: AHORA, generarToken: token }));
    if (!nuevo.ok || !nuevo.token) throw new Error("esperaba token");
    expect((await aceptar(nuevo.token)).ok).toBe(true);
    expect(await membresias()).toHaveLength(1);
  });
});

describe("quien ya es miembro", () => {
  it("si ya tenía la cuenta y una membresía en la sucursal, la actualiza (rol y activo) en lugar de duplicar", async () => {
    const u = await prismaAdmin.user.create({ data: { email: EMAIL } });
    await prismaAdmin.usuarioEmpresa.create({ data: { usuarioId: u.id, empresaId: E } });
    await prismaAdmin.usuarioSucursal.create({ data: { usuarioId: u.id, sucursalId: sucursal1, empresaId: E, rolId: rolOperador, activo: false } });
    const inv = await invitar([{ sucursalId: sucursal1, rolId: rolOperador }]);
    expect((await aceptar(inv.token)).ok).toBe(true);
    expect((await membresias()).map((m) => m.activo)).toEqual([true]);
  });
});
