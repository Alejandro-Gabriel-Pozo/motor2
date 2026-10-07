import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, prismaAdmin } from "../setup/test-db";
import { decidirInicioDeSesion } from "../../src/server/sesion/acceso";
import { generarTokenOpaco, hashDeToken } from "../../src/core/seguridad/tokens";
import { azarDelProceso } from "../../src/lib/azar";

/**
 * E8 (ADR-024): la decisión de `signIn` con el enlace automático de cuentas por email apagado. Un User que ya existe y no tiene cuenta de Google solo entra si una invitación
 * sirve para vincularla; con otra cuenta de Google no entra; un email desconocido entra solo por las vías de siempre.
 */
const EMPRESA = "empresa_principal";
const EN_ALTA = "empresa_en_alta";
const EMAIL = "precargado@ejemplo.com";
const SUB = "google-sub-1";
const FALTA = "/login?aviso=falta-invitacion";
const DISTINTA = "/login?aviso=cuenta-distinta";
let invitadorId: string;

const cuenta = (sub = SUB) => ({ providerAccountId: sub, type: "oidc", access_token: "a", id_token: "id-token-de-prueba" });
const entrar = (token: string | undefined, o: { email?: string; perfil?: string; sub?: string; verificado?: boolean; abierta?: string } = {}) =>
  decidirInicioDeSesion({
    emailUsuario: o.email ?? EMAIL,
    emailPerfil: o.perfil ?? o.email ?? EMAIL,
    emailVerificado: o.verificado ?? true,
    hd: undefined,
    tokenDeSesionAbierta: o.abierta,
    tokenDeInvitacion: token,
    cuenta: cuenta(o.sub),
  });

async function invitacion(tipo: "usuario" | "vinculacion" | "gerente", parcial: { email?: string; empresaId?: string; venceEn?: Date; estado?: "REVOCADA" } = {}) {
  const token = generarTokenOpaco(azarDelProceso);
  await prismaAdmin.invitacion.create({
    data: {
      empresaId: parcial.empresaId ?? EMPRESA,
      email: parcial.email ?? EMAIL,
      rolEmpresa: tipo,
      hashToken: hashDeToken(token),
      venceEn: parcial.venceEn ?? new Date(Date.now() + 3_600_000),
      ...(tipo === "gerente" ? {} : { invitadoPorId: invitadorId }),
      ...(parcial.estado === "REVOCADA" ? { estado: "REVOCADA" as const, revocadaEn: new Date() } : {}),
    },
  });
  return token;
}

/** Un usuario precargado: tiene su User y su membresía activa (por eso pasa el gate) pero ninguna cuenta de Google. */
async function precargado(email = EMAIL, extra: { activoGlobal?: boolean } = {}) {
  const user = await prismaAdmin.user.create({ data: { email, ...extra } });
  const sucursal = await prismaAdmin.sucursal.findFirstOrThrow({ where: { empresaId: EMPRESA } });
  const rol = await prismaAdmin.rol.findFirstOrThrow({ where: { empresaId: EMPRESA } });
  await prismaAdmin.usuarioEmpresa.create({ data: { usuarioId: user.id, empresaId: EMPRESA } });
  await prismaAdmin.usuarioSucursal.create({ data: { usuarioId: user.id, sucursalId: sucursal.id, empresaId: EMPRESA, rolId: rol.id } });
  return user;
}

const cuentasDe = (email = EMAIL) => prismaAdmin.account.findMany({ where: { user: { email } } });

beforeEach(async () => {
  await limpiarBaseDeTest();
  await prismaAdmin.empresa.update({ where: { id: EMPRESA }, data: { estado: "ACTIVE" } });
  await prismaAdmin.empresa.create({ data: { id: EN_ALTA, nombre: "En alta", slug: "en-alta", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "PROVISIONING" } });
  await prismaAdmin.sucursal.create({ data: { empresaId: EMPRESA, nombre: "Centro" } });
  await prismaAdmin.rol.create({ data: { empresaId: EMPRESA, nombre: "operador" } });
  invitadorId = (await prismaAdmin.user.create({ data: { email: "gestor@ejemplo.com" } })).id;
});

afterAll(async () => {
  await limpiarBaseDeTest();
  await prismaAdmin.$disconnect();
});

describe("el gate de siempre sigue mandando", () => {
  it("un email sin verificar no entra", async () => {
    await precargado();
    expect(await entrar(await invitacion("vinculacion"), { verificado: false })).toBe(false);
    expect(await cuentasDe()).toHaveLength(0);
  });

  it("un desconocido sin invitación no entra, y uno con invitación de VINCULACIÓN tampoco (esa no abre la vía 3)", async () => {
    expect(await entrar(undefined, { email: "desconocido@ejemplo.com" })).toBe(false);
    expect(await entrar(await invitacion("vinculacion", { email: "desconocido@ejemplo.com" }), { email: "desconocido@ejemplo.com" })).toBe(false);
  });

  it("el kill-switch va antes de vincular: con la cuenta apagada no se crea ninguna Account y se explica por qué", async () => {
    await precargado(EMAIL, { activoGlobal: false });
    expect(await entrar(await invitacion("vinculacion"))).toBe("/login?aviso=cuenta-desactivada");
    expect(await cuentasDe()).toHaveLength(0);
  });

  it("con una sesión abierta de OTRO email no entra ni vincula", async () => {
    await precargado();
    const otro = await prismaAdmin.user.create({ data: { email: "otro@ejemplo.com" } });
    await prismaAdmin.session.create({ data: { sessionToken: "sesion-de-otro", userId: otro.id, expires: new Date(Date.now() + 3_600_000) } });
    expect(await entrar(await invitacion("vinculacion"), { abierta: "sesion-de-otro" })).toBe(false);
    expect(await cuentasDe()).toHaveLength(0);
  });
});

describe("un email que todavía no existe", () => {
  it("con una invitación de USUARIO de una empresa activa entra, y no escribe nada (Auth.js crea el User)", async () => {
    const usuarios = await prismaAdmin.user.count();
    expect(await entrar(await invitacion("usuario", { email: "nueva@ejemplo.com" }), { email: "nueva@ejemplo.com" })).toBe(true);
    expect(await prismaAdmin.user.count()).toBe(usuarios);
  });

  it("con una invitación de USUARIO de una empresa suspendida, o vencida, o de otro email, no entra", async () => {
    await prismaAdmin.empresa.update({ where: { id: EMPRESA }, data: { estado: "SUSPENDED" } });
    expect(await entrar(await invitacion("usuario", { email: "nueva@ejemplo.com" }), { email: "nueva@ejemplo.com" })).toBe(false);
    await prismaAdmin.empresa.update({ where: { id: EMPRESA }, data: { estado: "ACTIVE" } });
    await prismaAdmin.invitacion.deleteMany();
    expect(await entrar(await invitacion("usuario", { email: "nueva@ejemplo.com", venceEn: new Date(Date.now() - 1000) }), { email: "nueva@ejemplo.com" })).toBe(false);
    await prismaAdmin.invitacion.deleteMany();
    expect(await entrar(await invitacion("usuario", { email: "nueva@ejemplo.com" }), { email: "otra@ejemplo.com" })).toBe(false);
  });
});

describe("un usuario precargado (existe, tiene membresía, no tiene Google)", () => {
  it("sin invitación NO entra (falta-invitacion) y no se crea ninguna cuenta", async () => {
    await precargado();
    expect(await entrar(undefined)).toBe(FALTA);
    expect(await cuentasDe()).toHaveLength(0);
  });

  it("con la invitación de VINCULACIÓN entra: queda la Account (sub e id_token), la invitación ACEPTADA y la auditoría", async () => {
    const u = await precargado();
    const token = await invitacion("vinculacion");
    expect(await entrar(token)).toBe(true);
    const cuentas = await cuentasDe();
    expect(cuentas).toMatchObject([{ provider: "google", providerAccountId: SUB, id_token: "id-token-de-prueba", userId: u.id }]);
    expect(await prismaAdmin.invitacion.findUniqueOrThrow({ where: { hashToken: hashDeToken(token) } })).toMatchObject({ estado: "ACEPTADA", aceptadaPorId: u.id });
    expect(await prismaAdmin.registroAuditoria.count({ where: { entidad: "UsuarioEmpresa", campo: "cuentaGoogle", actorId: u.id } })).toBe(1);
  });

  it("después de vincular, volver a entrar con la misma cuenta funciona sin invitación", async () => {
    await precargado();
    await entrar(await invitacion("vinculacion"));
    expect(await entrar(undefined)).toBe(true);
    expect(await cuentasDe()).toHaveLength(1);
  });

  it("la invitación de USUARIO también vincula, pero NO se consume (la consume la aceptación)", async () => {
    await precargado();
    const token = await invitacion("usuario");
    expect(await entrar(token)).toBe(true);
    expect(await cuentasDe()).toHaveLength(1);
    expect(await prismaAdmin.invitacion.findUniqueOrThrow({ where: { hashToken: hashDeToken(token) } })).toMatchObject({ estado: "PENDIENTE" });
  });

  it("la invitación de GERENTE de una empresa en alta también vincula sin consumirla", async () => {
    await precargado();
    const token = await invitacion("gerente", { empresaId: EN_ALTA });
    expect(await entrar(token)).toBe(true);
    expect(await cuentasDe()).toHaveLength(1);
    expect(await prismaAdmin.invitacion.findUniqueOrThrow({ where: { hashToken: hashDeToken(token) } })).toMatchObject({ estado: "PENDIENTE" });
  });

  it("no vincula con una invitación de otro email, vencida, revocada, ya aceptada ni de una empresa suspendida", async () => {
    await precargado();
    expect(await entrar(await invitacion("vinculacion", { email: "otro@ejemplo.com" }))).toBe(FALTA);
    await prismaAdmin.invitacion.deleteMany();
    expect(await entrar(await invitacion("vinculacion", { venceEn: new Date(Date.now() - 1000) }))).toBe(FALTA);
    await prismaAdmin.invitacion.deleteMany();
    expect(await entrar(await invitacion("vinculacion", { estado: "REVOCADA" }))).toBe(FALTA);
    await prismaAdmin.invitacion.deleteMany();
    const aceptada = await invitacion("vinculacion");
    const otro = await prismaAdmin.user.create({ data: { email: "quien@ejemplo.com" } });
    await prismaAdmin.invitacion.update({ where: { hashToken: hashDeToken(aceptada) }, data: { estado: "ACEPTADA", aceptadaEn: new Date(), aceptadaPorId: otro.id } });
    expect(await entrar(aceptada)).toBe(FALTA);
    await prismaAdmin.invitacion.deleteMany();
    const token = await invitacion("vinculacion");
    await prismaAdmin.empresa.update({ where: { id: EMPRESA }, data: { estado: "SUSPENDED" } });
    expect(await entrar(token)).toBe(FALTA);
    expect(await cuentasDe()).toHaveLength(0);
  });

  it("el email del perfil con mayúsculas se trata igual", async () => {
    await precargado();
    expect(await entrar(await invitacion("vinculacion"), { email: "Precargado@Ejemplo.com" })).toBe(true);
    expect(await cuentasDe()).toHaveLength(1);
  });

  it("dos intentos a la vez dejan UNA sola cuenta y la invitación aceptada una vez", async () => {
    await precargado();
    const token = await invitacion("vinculacion");
    const resultados = await Promise.all([entrar(token), entrar(token)]);
    expect(resultados.every((r) => r === true || r === FALTA)).toBe(true);
    expect(resultados).toContain(true);
    expect(await cuentasDe()).toHaveLength(1);
  });
});

describe("un usuario que ya tiene Google", () => {
  it("con el mismo identificador entra", async () => {
    const u = await precargado();
    await prismaAdmin.account.create({ data: { userId: u.id, type: "oidc", provider: "google", providerAccountId: SUB, id_token: "x" } });
    expect(await entrar(undefined)).toBe(true);
  });

  it("con OTRO identificador (cuenta rehecha) NO entra, aunque traiga una invitación válida, y no se agrega ninguna cuenta (D2)", async () => {
    const u = await precargado();
    await prismaAdmin.account.create({ data: { userId: u.id, type: "oidc", provider: "google", providerAccountId: SUB, id_token: "x" } });
    expect(await entrar(await invitacion("vinculacion"), { sub: "google-sub-2" })).toBe(DISTINTA);
    expect(await cuentasDe()).toHaveLength(1);
  });
});
