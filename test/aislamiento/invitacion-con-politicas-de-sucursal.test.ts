import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";
import { AHORA_DE_LA_CORRIDA, HORA_MS } from "../setup/tiempo";
import { generarTokenOpaco, hashDeToken } from "../../src/core/seguridad/tokens";
import { azarDelProceso } from "../../src/lib/azar";
import { sembrarEmpresa } from "../../plataforma/src/servidor/sembrar-empresa";
import { incorporarPrimerGerente } from "../../src/server/actions/auth/casos-de-uso/incorporar-primer-gerente-en-tx";

/**
 * B6 de la RLS por sucursal (paquete 1; ADR-028): ACEPTAR UNA INVITACIÓN con las políticas por sucursal puestas. Aceptar escribe `RegistroAuditoria` (por sucursal y, la de la cuenta en la
 * empresa, con `sucursalId` NULL), y con las políticas esa tabla exige un alcance de ESCRITURA: quien acepta todavía no tiene membresías ni contexto de usuario, así que la transacción de la
 * invitación (`invitacionConSuBase`, `src/server/sesion/invitacion.ts`) se abre con lectura y escritura SOLO en las sucursales de la propia invitación. Sin eso, aceptar daba 42501.
 *
 * Se arma una base TEMPORAL con todas las migraciones y se le ponen las políticas que genera `test/setup/politicas-de-alcance-de-sucursal.ts` (así el archivo prueba lo mismo con la base de CI
 * que todavía no las trae y con la que ya las trae); el código real de `src/` corre contra ella como `motor2_app`, sujeto a la RLS. Qué prueba:
 *  - el control: SIN alcance (`dbDeEmpresa(empresa)`) esa base no deja escribir ni ver la auditoría (las políticas están de verdad);
 *  - aceptar la invitación de USUARIO, la del primer GERENTE y la VINCULACIÓN de la cuenta de Google deja su auditoría;
 *  - el alcance es exactamente las sucursales de la invitación (no la sucursal que no se invitó, ni las de otra empresa) y se cierra del todo si la invitación ya no está pendiente.
 * Mutaciones (revertidas editando `invitacion.ts`): quitar el alcance (`transaccionDeLaEmpresa(empresaId)`) ⇒ rojo en las tres aceptaciones; alcance con todas las sucursales de la empresa ⇒ rojo en
 * «no se ensancha»; alcance sin mirar el estado ⇒ rojo en «ya no está pendiente».
 */
const E1 = "emp_uno";
const E2 = "emp_dos";
const E3 = "emp_alta";
const EMAIL = "nueva-persona@gmail.com";
const EMAIL_DEL_GERENTE = "dueno-nuevo@gmail.com";
const EMAIL_PRECARGADO = "precargado@gmail.com";
const AHORA = AHORA_DE_LA_CORRIDA;
const VENCE = new Date(AHORA.getTime() + HORA_MS);

let base: BaseTemporalMigrada;
let duenio: PrismaClient;
let hayRol = false;
let modulo: {
  invitacionConSuBase: typeof import("@/server/sesion/invitacion").invitacionConSuBase;
  aceptarUsuario: typeof import("@/server/actions/auth/casos-de-uso/aceptar-invitacion-de-usuario").aceptarInvitacionDeUsuarioCasoDeUso;
  aceptarGerente: typeof import("@/server/actions/auth/casos-de-uso/aceptar-invitacion-de-gerente").aceptarInvitacionDeGerenteCasoDeUso;
  vincular: typeof import("@/server/sesion/vincular-cuenta").vincularCuentaConInvitacion;
  requierePermiso: typeof import("@/server/acceso/gate").requierePermiso;
  dbDeEmpresa: typeof import("@/server/sesion/base").dbDeEmpresa;
};
let prismaDelProceso: PrismaClient | undefined;
const entorno = { url: process.env.DATABASE_URL, prisma: (globalThis as { prisma?: PrismaClient }).prisma };

// El mundo (ids que se llenan al sembrar).
const mundo = { gerente: "", s1: "", s2: "", s3: "", t1: "", c1: "", rolOperador: "", rolOperadorDos: "", rolAdmin: "" };

beforeAll(async () => {
  base = await crearBaseTemporalMigrada();
  await base.aplicarRestantes();
  hayRol = (await base.cliente.query("SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app'")).rowCount === 1;
  if (!hayRol) return;
  await base.cliente.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO motor2_app`);
  duenio = new PrismaClient({ adapter: new PrismaPg({ connectionString: base.url }) });
  await sembrar(duenio);
  // Las 128 políticas ya son migraciones (B1 a B6): `aplicarRestantes` las trae, no hace falta aplicar el SQL del generador.

  // El runtime de `src/` (el rol de la app, `motor2_app`) apuntando a la base temporal: `src/lib/db.ts` lee `DATABASE_URL` al importarse y se queda con un singleton en `globalThis`.
  const url = new URL(process.env.DATABASE_URL as string);
  url.pathname = new URL(base.url).pathname;
  process.env.DATABASE_URL = url.toString();
  delete (globalThis as { prisma?: PrismaClient }).prisma;
  vi.resetModules();
  modulo = {
    invitacionConSuBase: (await import("@/server/sesion/invitacion")).invitacionConSuBase,
    aceptarUsuario: (await import("@/server/actions/auth/casos-de-uso/aceptar-invitacion-de-usuario")).aceptarInvitacionDeUsuarioCasoDeUso,
    aceptarGerente: (await import("@/server/actions/auth/casos-de-uso/aceptar-invitacion-de-gerente")).aceptarInvitacionDeGerenteCasoDeUso,
    vincular: (await import("@/server/sesion/vincular-cuenta")).vincularCuentaConInvitacion,
    requierePermiso: (await import("@/server/acceso/gate")).requierePermiso,
    dbDeEmpresa: (await import("@/server/sesion/base")).dbDeEmpresa,
  };
  prismaDelProceso = (await import("@/lib/db")).prisma;
}, 180_000);

afterAll(async () => {
  await prismaDelProceso?.$disconnect().catch(() => undefined);
  if (entorno.url === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = entorno.url;
  (globalThis as { prisma?: PrismaClient }).prisma = entorno.prisma;
  await duenio?.$disconnect().catch(() => undefined);
  await base?.eliminar();
});

/** Tres empresas: E1 (activa, tres sucursales y un gerente que invita), E2 (activa, otra sucursal) y E3 (en alta, sin gerente). */
async function sembrar(d: PrismaClient) {
  const empresa = (id: string, estado: "ACTIVE" | "PROVISIONING") =>
    d.empresa.create({ data: { id, nombre: id, slug: id.replace("_", "-"), zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado } });
  const sembrada = (id: string, nombreSucursal: string) =>
    d.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.empresa_id', ${id}, true)`;
      return sembrarEmpresa(tx, id, nombreSucursal);
    });

  await empresa(E1, "ACTIVE");
  const uno = await sembrada(E1, "Central");
  mundo.s1 = uno.sucursal.id;
  mundo.rolAdmin = uno.rolAdmin.id;
  mundo.rolOperador = uno.rolOperador.id;
  mundo.s2 = (await d.sucursal.create({ data: { empresaId: E1, nombre: "Norte" } })).id;
  mundo.s3 = (await d.sucursal.create({ data: { empresaId: E1, nombre: "Sur" } })).id;
  mundo.gerente = (await d.user.create({ data: { email: "gerente@gmail.com" } })).id;
  await d.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.empresa_id', ${E1}, true)`;
    await incorporarPrimerGerente(tx, { empresaId: E1, usuarioId: mundo.gerente });
  });
  for (const sucursalId of [mundo.s2, mundo.s3]) await d.usuarioSucursal.create({ data: { usuarioId: mundo.gerente, sucursalId, empresaId: E1, rolId: mundo.rolAdmin } });

  await empresa(E2, "ACTIVE");
  const dos = await sembrada(E2, "Central dos");
  mundo.t1 = dos.sucursal.id;
  mundo.rolOperadorDos = dos.rolOperador.id;

  await empresa(E3, "PROVISIONING");
  mundo.c1 = (await sembrada(E3, "Central alta")).sucursal.id;

  // Un usuario precargado (tiene cuenta y membresía en E1, todavía sin Google): el que se vincula.
  const precargado = await d.user.create({ data: { email: EMAIL_PRECARGADO } });
  await d.usuarioEmpresa.create({ data: { usuarioId: precargado.id, empresaId: E1 } });
  await d.usuarioSucursal.create({ data: { usuarioId: precargado.id, sucursalId: mundo.s2, empresaId: E1, rolId: mundo.rolOperador } });
}

const token = () => generarTokenOpaco(azarDelProceso);

/** Una invitación de USUARIO a esas sucursales (con el rol operador de la empresa) hecha por el gerente de E1 (o por nadie, si es de otra empresa). */
async function invitarUsuario(empresaId: string, sucursales: string[], o: { email?: string; estado?: "PENDIENTE" | "REVOCADA"; venceEn?: Date } = {}) {
  const t = token();
  const invitacion = await duenio.invitacion.create({
    data: {
      empresaId, email: o.email ?? EMAIL, rolEmpresa: "usuario", hashToken: hashDeToken(t), venceEn: o.venceEn ?? VENCE, invitadoPorId: mundo.gerente,
    },
  });
  for (const sucursalId of sucursales) {
    await duenio.invitacionSucursal.create({ data: { empresaId, invitacionId: invitacion.id, sucursalId, rolId: empresaId === E1 ? mundo.rolOperador : mundo.rolOperadorDos, invitadoPorId: mundo.gerente } });
  }
  // Un trigger exige que la invitación madre esté PENDIENTE al agregarle sucursales: se revoca después.
  if (o.estado === "REVOCADA") await duenio.invitacion.update({ where: { id: invitacion.id }, data: { estado: "REVOCADA", revocadaEn: AHORA } });
  return { token: t, id: invitacion.id };
}

async function invitarGerente(email = EMAIL_DEL_GERENTE) {
  const t = token();
  await duenio.invitacion.create({ data: { empresaId: E3, email, rolEmpresa: "gerente", hashToken: hashDeToken(t), venceEn: VENCE } });
  return t;
}

async function invitarVinculacion() {
  const t = token();
  await duenio.invitacion.create({ data: { empresaId: E1, email: EMAIL_PRECARGADO, rolEmpresa: "vinculacion", hashToken: hashDeToken(t), venceEn: VENCE, invitadoPorId: mundo.gerente } });
  return t;
}

const usuarioDe = (email: string) => duenio.user.upsert({ where: { email }, update: {}, create: { email } });

/** Las sucursales de la lectura y la escritura que la transacción de la invitación tiene fijadas (listas ordenadas; `[]` = sin alcance). */
async function alcanceDeLaTransaccion(t: string) {
  const invitacion = await modulo.invitacionConSuBase(t, AHORA);
  expect(invitacion, "la invitación tiene que resolver").not.toBeNull();
  return invitacion!.transaccion(async (tx) => {
    const [fila] = await tx.$queryRaw<{ lectura: string; escritura: string }[]>`SELECT current_setting('app.sucursales_lectura', true) AS lectura, current_setting('app.sucursales_escritura', true) AS escritura`;
    const lista = (v: string | null) => (v ? v.split(",").sort() : []);
    return { lectura: lista(fila.lectura), escritura: lista(fila.escritura) };
  });
}

/** Los intentos de escribir `RegistroAuditoria` en una sucursal DENTRO de la transacción de la invitación: el código SQLSTATE con el que fallan, o `null` si entró (siempre en una transacción que se deshace). */
async function auditarEn(t: string, sucursalId: string | null): Promise<string | null> {
  const invitacion = await modulo.invitacionConSuBase(t, AHORA);
  const sentinela = new Error("deshacer");
  let codigo: string | null = null;
  await invitacion!
    .transaccion(async (tx) => {
      try {
        await tx.registroAuditoria.create({
          data: { empresaId: invitacion!.vista.empresaId, entidad: "UsuarioSucursal", entidadId: "x", campo: "activo", descripcion: "prueba", valorAnterior: null, valorNuevo: "true", actorId: mundo.gerente, sucursalId },
        });
      } catch (e) {
        codigo = JSON.stringify([(e as { code?: string }).code, (e as { message?: string }).message, (e as { cause?: unknown }).cause]);
      }
      throw sentinela;
    })
    .catch((e: unknown) => {
      if (e !== sentinela) throw e;
    });
  return codigo;
}

describe("aceptar una invitación con las políticas de la RLS por sucursal puestas", () => {
  it("el control: sin alcance esta base no deja escribir ni ver la auditoría (si no, nada de lo de abajo prueba lo que dice)", async (ctx) => {
    if (!hayRol) return ctx.skip();
    const sinAlcance = modulo.dbDeEmpresa(E1);
    const escribir = sinAlcance.registroAuditoria.create({ data: { empresaId: E1, entidad: "X", entidadId: "x", campo: "c", descripcion: "d", valorAnterior: null, valorNuevo: "n", actorId: mundo.gerente, sucursalId: null } });
    await expect(escribir).rejects.toThrow(/row-level security|42501/);
    await duenio.registroAuditoria.create({ data: { empresaId: E1, entidad: "X", entidadId: "x", campo: "c", descripcion: "visible solo para el dueño", valorAnterior: null, valorNuevo: "n", actorId: mundo.gerente, sucursalId: mundo.s1 } });
    expect(await sinAlcance.registroAuditoria.count()).toBe(0);
    await duenio.registroAuditoria.deleteMany({ where: { descripcion: "visible solo para el dueño" } });
  });

  it("la invitación de USUARIO a dos sucursales deja la membresía de cada una y toda su auditoría (la de la cuenta en la empresa, de sucursal NULL, y las dos de cada sucursal)", async (ctx) => {
    if (!hayRol) return ctx.skip();
    const inv = await invitarUsuario(E1, [mundo.s1, mundo.s2]);
    const u = await usuarioDe(EMAIL);
    const r = await modulo.aceptarUsuario({ token: inv.token, usuario: { id: u.id, email: EMAIL }, ahora: AHORA }, modulo.requierePermiso);
    expect(r).toMatchObject({ ok: true, empresaId: E1 });
    expect((await duenio.usuarioSucursal.findMany({ where: { usuarioId: u.id }, select: { sucursalId: true } })).map((m) => m.sucursalId).sort()).toEqual([mundo.s1, mundo.s2].sort());
    const auditoria = await duenio.registroAuditoria.findMany({ where: { empresaId: E1, descripcion: { contains: EMAIL } }, select: { entidad: true, sucursalId: true, actorId: true } });
    expect(auditoria.filter((a) => a.sucursalId === null).map((a) => a.entidad)).toEqual(["UsuarioEmpresa"]);
    expect(auditoria.filter((a) => a.sucursalId === mundo.s1)).toHaveLength(2);
    expect(auditoria.filter((a) => a.sucursalId === mundo.s2)).toHaveLength(2);
    expect(auditoria.filter((a) => a.sucursalId === mundo.s3)).toHaveLength(0);
    expect(new Set(auditoria.map((a) => a.actorId))).toEqual(new Set([mundo.gerente]));
    expect((await duenio.invitacion.findUniqueOrThrow({ where: { id: inv.id } })).estado).toBe("ACEPTADA");
  });

  it("la invitación del primer GERENTE deja su auditoría (la de la cuenta, de empresa, y la de la membresía en la primera sucursal)", async (ctx) => {
    if (!hayRol) return ctx.skip();
    const t = await invitarGerente();
    const u = await usuarioDe(EMAIL_DEL_GERENTE);
    const r = await modulo.aceptarGerente({ token: t, usuario: { id: u.id, email: EMAIL_DEL_GERENTE }, cuit: "30-71234567-1", ahora: AHORA });
    expect(r).toMatchObject({ ok: true, empresaId: E3 });
    const auditoria = await duenio.registroAuditoria.findMany({ where: { empresaId: E3 }, select: { entidad: true, sucursalId: true, actorId: true } });
    expect(auditoria.map((a) => [a.entidad, a.sucursalId, a.actorId]).sort()).toEqual([["UsuarioEmpresa", null, u.id], ["UsuarioSucursal", mundo.c1, u.id]].sort());
  });

  it("la VINCULACIÓN de la cuenta de Google deja su auditoría de empresa y la Account", async (ctx) => {
    if (!hayRol) return ctx.skip();
    const t = await invitarVinculacion();
    const u = await usuarioDe(EMAIL_PRECARGADO);
    const vinculada = await modulo.vincular({ token: t, usuario: { id: u.id, email: EMAIL_PRECARGADO }, cuenta: { providerAccountId: "google-sub-precargado", type: "oidc", id_token: "id" }, ahora: AHORA });
    expect(vinculada).toBe(true);
    expect(await duenio.account.count({ where: { userId: u.id, provider: "google" } })).toBe(1);
    expect(await duenio.registroAuditoria.count({ where: { empresaId: E1, entidad: "UsuarioEmpresa", campo: "cuentaGoogle", actorId: u.id, sucursalId: null } })).toBe(1);
  });
});

describe("el alcance de la transacción de una invitación son las sucursales de ESA invitación y nada más", () => {
  it("la de usuario: exactamente las sucursales invitadas; no la que no se invitó de la misma empresa ni las de otra empresa", async (ctx) => {
    if (!hayRol) return ctx.skip();
    const dosSucursales = await invitarUsuario(E1, [mundo.s1, mundo.s2], { email: "alcance-uno@gmail.com" });
    const esperado = [mundo.s1, mundo.s2].sort();
    expect(await alcanceDeLaTransaccion(dosSucursales.token)).toEqual({ lectura: esperado, escritura: esperado });
    // Escribir la auditoría de una sucursal invitada (y la de empresa entera, de sucursal NULL, que pide un alcance fijado) entra; en la que no se invitó (S3) o en una de otra empresa (T1), no.
    expect(await auditarEn(dosSucursales.token, mundo.s2)).toBeNull();
    expect(await auditarEn(dosSucursales.token, null)).toBeNull();
    expect(await auditarEn(dosSucursales.token, mundo.s3)).toMatch(/42501|row-level security/);
    expect(await auditarEn(dosSucursales.token, mundo.t1)).not.toBeNull();
    // La invitación de otra empresa, para la MISMA persona: su alcance es el de SU sucursal, sin mezclar nada de E1.
    const deOtraEmpresa = await invitarUsuario(E2, [mundo.t1], { email: "alcance-uno@gmail.com" });
    expect(await alcanceDeLaTransaccion(deOtraEmpresa.token)).toEqual({ lectura: [mundo.t1], escritura: [mundo.t1] });
    expect(await auditarEn(deOtraEmpresa.token, mundo.s1)).not.toBeNull();
  });

  it("la de una sola sucursal no suma la otra; una sin sucursales no abre alcance", async (ctx) => {
    if (!hayRol) return ctx.skip();
    const una = await invitarUsuario(E1, [mundo.s3], { email: "alcance-dos@gmail.com" });
    expect(await alcanceDeLaTransaccion(una.token)).toEqual({ lectura: [mundo.s3], escritura: [mundo.s3] });
    const ninguna = await invitarUsuario(E1, [], { email: "alcance-tres@gmail.com" });
    expect(await alcanceDeLaTransaccion(ninguna.token)).toEqual({ lectura: [], escritura: [] });
    expect(await auditarEn(ninguna.token, null)).toMatch(/42501|row-level security/);
  });

  it("la del primer gerente: la primera sucursal activa de SU empresa, y la vinculación se ancla a la primera de la suya", async (ctx) => {
    if (!hayRol) return ctx.skip();
    expect(await alcanceDeLaTransaccion(await invitarGerente("alcance-gerente@gmail.com"))).toEqual({ lectura: [mundo.c1], escritura: [mundo.c1] });
    expect(await alcanceDeLaTransaccion(await invitarVinculacion())).toEqual({ lectura: [mundo.s1], escritura: [mundo.s1] });
  });

  it("una invitación que ya no está pendiente (revocada, vencida o aceptada) no abre ningún alcance", async (ctx) => {
    if (!hayRol) return ctx.skip();
    const revocada = await invitarUsuario(E1, [mundo.s1], { email: "alcance-cuatro@gmail.com", estado: "REVOCADA" });
    expect(await alcanceDeLaTransaccion(revocada.token)).toEqual({ lectura: [], escritura: [] });
    const vencida = await invitarUsuario(E1, [mundo.s1], { email: "alcance-cinco@gmail.com", venceEn: new Date(AHORA.getTime() - HORA_MS) });
    expect(await alcanceDeLaTransaccion(vencida.token)).toEqual({ lectura: [], escritura: [] });
    const aceptada = await invitarUsuario(E1, [mundo.s1], { email: "alcance-seis@gmail.com" });
    await duenio.invitacion.update({ where: { id: aceptada.id }, data: { estado: "ACEPTADA", aceptadaEn: AHORA, aceptadaPorId: mundo.gerente } });
    expect(await alcanceDeLaTransaccion(aceptada.token)).toEqual({ lectura: [], escritura: [] });
  });
});
