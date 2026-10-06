import { beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { inicioDeSesionPermitido } from "../../src/core/auth/acceso";
import { detectarCuentasDeGoogleSospechosas } from "../../src/core/auth/cuentas-vinculadas";

/** S-01: con una sesión abierta, otra cuenta de Google no puede vincularse al usuario de esa sesión (`allowDangerousEmailAccountLinking`). */
describe("inicioDeSesionPermitido", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
  });

  async function dosUsuarios() {
    const base = await sembrarBase();
    const victima = await crearUsuarioConMembresia({ email: "victima@gmail.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    const atacante = await crearUsuarioConMembresia({ email: "atacante@gmail.com", sucursalId: base.sucursal.id, rolId: base.operador.id });
    return { victima, atacante };
  }

  const abrirSesion = (userId: string, sessionToken: string, expires = new Date(Date.now() + 3_600_000)) => prisma.session.create({ data: { userId, sessionToken, expires } });

  it("sin sesión abierta y con el mismo email en el perfil, entra (alta existente)", async () => {
    await dosUsuarios();
    expect(await inicioDeSesionPermitido({ emailUsuario: "victima@gmail.com", emailPerfil: "victima@gmail.com", hd: undefined, tokenDeSesionAbierta: undefined })).toBe(true);
  });

  it("con una sesión abierta de OTRO email, rechaza: la cuenta de Google no se vincula a quien tiene la sesión", async () => {
    const { victima } = await dosUsuarios();
    await abrirSesion(victima.id, "token-victima");
    expect(await inicioDeSesionPermitido({ emailUsuario: "atacante@gmail.com", emailPerfil: "atacante@gmail.com", hd: undefined, tokenDeSesionAbierta: "token-victima" })).toBe(false);
  });

  it("con una sesión abierta del MISMO usuario (volver a iniciar), entra", async () => {
    const { victima } = await dosUsuarios();
    await abrirSesion(victima.id, "token-victima");
    expect(await inicioDeSesionPermitido({ emailUsuario: "victima@gmail.com", emailPerfil: "victima@gmail.com", hd: undefined, tokenDeSesionAbierta: "token-victima" })).toBe(true);
  });

  it("una sesión vencida o un token desconocido no cuentan como sesión abierta", async () => {
    const { victima } = await dosUsuarios();
    await abrirSesion(victima.id, "token-vencido", new Date(Date.now() - 1000));
    for (const token of ["token-vencido", "token-que-no-existe"]) {
      expect(await inicioDeSesionPermitido({ emailUsuario: "atacante@gmail.com", emailPerfil: "atacante@gmail.com", hd: undefined, tokenDeSesionAbierta: token })).toBe(true);
    }
  });

  it("rechaza si el email del perfil de Google no es el del usuario al que se vincularía la cuenta", async () => {
    await dosUsuarios();
    expect(await inicioDeSesionPermitido({ emailUsuario: "victima@gmail.com", emailPerfil: "atacante@gmail.com", hd: undefined, tokenDeSesionAbierta: undefined })).toBe(false);
  });

  it("compara los emails sin distinguir mayúsculas ni espacios", async () => {
    await dosUsuarios();
    expect(await inicioDeSesionPermitido({ emailUsuario: "victima@gmail.com", emailPerfil: " Victima@Gmail.com ", hd: undefined, tokenDeSesionAbierta: undefined })).toBe(true);
  });

  it("sigue aplicando el resto del control de acceso (un email sin alta no entra)", async () => {
    await dosUsuarios();
    expect(await inicioDeSesionPermitido({ emailUsuario: "nadie@afuera.com", emailPerfil: "nadie@afuera.com", hd: undefined, tokenDeSesionAbierta: undefined })).toBe(false);
  });
});

describe("detectarCuentasDeGoogleSospechosas", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
  });

  const idToken = (email: string) => `cabecera.${Buffer.from(JSON.stringify({ email })).toString("base64url")}.firma`;
  const cuenta = (userId: string, providerAccountId: string, email: string | null) =>
    prisma.account.create({ data: { userId, type: "oidc", provider: "google", providerAccountId, id_token: email ? idToken(email) : null } });

  it("lista al usuario con dos cuentas de Google, y al que tiene una cuya identidad firmada es de otro email; ignora al limpio", async () => {
    const base = await sembrarBase();
    const limpio = await crearUsuarioConMembresia({ email: "limpio@gmail.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    const doble = await crearUsuarioConMembresia({ email: "doble@gmail.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    const ajeno = await crearUsuarioConMembresia({ email: "ajeno@gmail.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await cuenta(limpio.id, "g-1", "limpio@gmail.com");
    await cuenta(doble.id, "g-2", "doble@gmail.com");
    await cuenta(doble.id, "g-3", "doble@gmail.com");
    await cuenta(ajeno.id, "g-4", "intruso@gmail.com");

    const sospechosos = await detectarCuentasDeGoogleSospechosas(prisma);
    expect(sospechosos.map((s) => [s.usuarioEmail, s.motivos])).toEqual([
      ["ajeno@gmail.com", ["email-distinto"]],
      ["doble@gmail.com", ["varias-cuentas"]],
    ]);
    expect(sospechosos[0]!.cuentas).toEqual([{ providerAccountId: "g-4", emailEnLaCuenta: "intruso@gmail.com" }]);
  });

  it("una cuenta sin id_token (o ilegible) no se marca por email: no hay con qué comparar", async () => {
    const base = await sembrarBase();
    const u = await crearUsuarioConMembresia({ email: "sin-token@gmail.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await cuenta(u.id, "g-5", null);
    await prisma.account.create({ data: { userId: u.id, type: "oidc", provider: "google", providerAccountId: "g-6", id_token: "no-es-un-jwt" } });
    expect((await detectarCuentasDeGoogleSospechosas(prisma)).map((s) => s.motivos)).toEqual([["varias-cuentas"]]);
  });
});
