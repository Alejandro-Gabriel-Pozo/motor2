import { beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, prismaAdmin } from "../setup/test-db";
import { inicioDeSesionPermitido } from "../../src/server/sesion/acceso";
import { invitacionDelToken, nombreCookieInvitacion, opcionesCookieInvitacion } from "../../src/core/auth/invitacion";
import { generarTokenOpaco, hashDeToken } from "../../src/core/seguridad/tokens";
import { azarDelProceso } from "../../src/lib/azar";

/**
 * E5 (ADR-020), cuarta vía del gate de login: una invitación de gerente pendiente, no vencida, de una empresa en alta, con la cuenta de Google del MISMO
 * email invitado. Sin ninguna otra alta previa en la base (el invitado es un desconocido para el gate).
 */
const EMPRESA = "nueva-en-alta";
const EMAIL = "dueno@gmail.com";

async function crearInvitacion(parcial: { email?: string; venceEn?: Date; estado?: "PENDIENTE" | "REVOCADA" } = {}) {
  const token = generarTokenOpaco(azarDelProceso);
  await prismaAdmin.invitacion.create({
    data: {
      empresaId: EMPRESA,
      email: parcial.email ?? EMAIL,
      rolEmpresa: "gerente",
      hashToken: hashDeToken(token),
      venceEn: parcial.venceEn ?? new Date(Date.now() + 3_600_000),
      ...(parcial.estado === "REVOCADA" ? { estado: "REVOCADA" as const, revocadaEn: new Date() } : {}),
    },
  });
  return token;
}

const entrar = (token: string | undefined, email = EMAIL) =>
  inicioDeSesionPermitido({ emailUsuario: email, emailPerfil: email, hd: undefined, tokenDeSesionAbierta: undefined, tokenDeInvitacion: token });

beforeEach(async () => {
  await limpiarBaseDeTest();
  await prismaAdmin.empresa.create({ data: { id: EMPRESA, nombre: "Nueva en alta", slug: "nueva-en-alta", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "PROVISIONING" } });
});

describe("gate de login con invitación", () => {
  it("sin invitación, un desconocido no entra (la vía nueva no abre nada por sí sola)", async () => {
    expect(await entrar(undefined)).toBe(false);
    expect(await entrar(generarTokenOpaco(azarDelProceso))).toBe(false);
    expect(await entrar("corto")).toBe(false);
  });

  it("con una invitación pendiente y el mismo email, entra (aunque el email llegue con otras mayúsculas)", async () => {
    const token = await crearInvitacion();
    expect(await entrar(token)).toBe(true);
    expect(await entrar(token, "Dueno@Gmail.com")).toBe(true);
  });

  it("con otro email no entra, aunque el token sea válido", async () => {
    const token = await crearInvitacion();
    expect(await entrar(token, "otro@gmail.com")).toBe(false);
  });

  it("no entra si la invitación venció, fue revocada o ya fue aceptada", async () => {
    expect(await entrar(await crearInvitacion({ venceEn: new Date(Date.now() - 1000), email: "vencida@gmail.com" }), "vencida@gmail.com")).toBe(false);
    await prismaAdmin.invitacion.deleteMany(); // una sola PENDIENTE de gerente por empresa (índice parcial)
    expect(await entrar(await crearInvitacion({ estado: "REVOCADA", email: "revocada@gmail.com" }), "revocada@gmail.com")).toBe(false);
    const token = await crearInvitacion({ email: "aceptada@gmail.com" });
    const usuario = await prismaAdmin.user.create({ data: { email: "aceptada@gmail.com" } });
    await prismaAdmin.invitacion.update({ where: { hashToken: hashDeToken(token) }, data: { estado: "ACEPTADA", aceptadaEn: new Date(), aceptadaPorId: usuario.id } });
    expect(await entrar(token, "aceptada@gmail.com")).toBe(false);
  });

  it("no entra si la empresa ya no está en alta (activada o suspendida)", async () => {
    const token = await crearInvitacion();
    await prismaAdmin.empresa.update({ where: { id: EMPRESA }, data: { estado: "ACTIVE" } });
    expect(await entrar(token)).toBe(false);
  });

  it("una invitación de USUARIO o de VINCULACIÓN no abre esta vía: solo la de gerente (E8, ADR-024)", async () => {
    const quien = await prismaAdmin.user.create({ data: { email: "quien-invita@gmail.com" } });
    for (const [rol, email] of [["usuario", "usuario@gmail.com"], ["vinculacion", "vincular@gmail.com"]] as const) {
      const token = generarTokenOpaco(azarDelProceso);
      await prismaAdmin.invitacion.create({ data: { empresaId: EMPRESA, email, rolEmpresa: rol, invitadoPorId: quien.id, hashToken: hashDeToken(token), venceEn: new Date(Date.now() + 3_600_000) } });
      expect(await entrar(token, email), rol).toBe(false);
    }
  });

  it("el kill-switch manda: un usuario con la cuenta desactivada no entra ni con invitación válida", async () => {
    const token = await crearInvitacion();
    await prismaAdmin.user.create({ data: { email: EMAIL, activoGlobal: false } });
    expect(await entrar(token)).toBe(false);
  });

  it("la regla de la sesión abierta de otro email se mantiene", async () => {
    const token = await crearInvitacion();
    const otro = await prismaAdmin.user.create({ data: { email: "otro@gmail.com" } });
    await prismaAdmin.session.create({ data: { userId: otro.id, sessionToken: "sesion-de-otro", expires: new Date(Date.now() + 3_600_000) } });
    expect(await inicioDeSesionPermitido({ emailUsuario: EMAIL, emailPerfil: EMAIL, hd: undefined, tokenDeSesionAbierta: "sesion-de-otro", tokenDeInvitacion: token })).toBe(false);
  });
});

describe("invitacionDelToken", () => {
  it("devuelve la vista sin el hash, con el estado efectivo, y null para un token desconocido o mal formado", async () => {
    const token = await crearInvitacion();
    const vista = await invitacionDelToken(token);
    expect(vista).toMatchObject({ empresaId: EMPRESA, nombreEmpresa: "Nueva en alta", estadoEmpresa: "PROVISIONING", email: EMAIL, estado: "PENDIENTE" });
    expect(JSON.stringify(vista)).not.toContain(hashDeToken(token));
    expect((await invitacionDelToken(token, new Date(Date.now() + 2 * 3_600_000)))?.estado).toBe("VENCIDA");
    expect(await invitacionDelToken(generarTokenOpaco(azarDelProceso))).toBeNull();
    expect(await invitacionDelToken("no-es-un-token")).toBeNull();
    expect(await invitacionDelToken(undefined)).toBeNull();
  });
});

describe("invitacionDelToken busca por el hash del token, no solo por el RLS", () => {
  it("con una invitación visible por el respaldo de la única empresa activa, un token inexistente da null y el de otra empresa devuelve la suya", async () => {
    // La única empresa ACTIVE (principal) tiene una invitación aceptada: con el respaldo de `app_empresa_actual()` el RLS la deja ver sin contexto.
    const u = await prismaAdmin.user.create({ data: { email: "ya-gerente@gmail.com" } });
    await prismaAdmin.invitacion.create({
      data: { empresaId: "empresa_principal", email: "ya-gerente@gmail.com", rolEmpresa: "gerente", hashToken: hashDeToken("T".repeat(43)), venceEn: new Date(Date.now() + 3_600_000), estado: "ACEPTADA", aceptadaEn: new Date(), aceptadaPorId: u.id },
    });
    expect(await invitacionDelToken(generarTokenOpaco(azarDelProceso))).toBeNull();
    const token = await crearInvitacion();
    expect(await invitacionDelToken(token)).toMatchObject({ empresaId: EMPRESA, email: EMAIL });
  });
});

describe("cookie de invitación", () => {
  it("lleva el prefijo __Host- solo con https, es Lax y httpOnly, y no vive más de una hora ni más que la invitación", () => {
    expect(nombreCookieInvitacion({ NODE_ENV: "production", VERCEL: "1" })).toBe("__Host-motor2.invitacion");
    expect(nombreCookieInvitacion({ NODE_ENV: "development" })).toBe("motor2.invitacion");
    const ahora = new Date("2026-10-04T12:00:00Z");
    const larga = opcionesCookieInvitacion({ NODE_ENV: "production", VERCEL: "1" }, new Date("2026-10-11T12:00:00Z"), ahora);
    expect(larga).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/", secure: true, maxAge: 3600 });
    expect(opcionesCookieInvitacion({}, new Date("2026-10-04T12:10:00Z"), ahora).maxAge).toBe(600);
    expect(opcionesCookieInvitacion({}, new Date("2026-10-04T11:00:00Z"), ahora).maxAge).toBe(0);
  });
});
