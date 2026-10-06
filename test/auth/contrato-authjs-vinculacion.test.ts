import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prismaAdmin } from "../setup/test-db";
// `handleLoginOrRegister` no está en los `exports` de @auth/core: se importa por ruta. Si una actualización de Auth.js lo mueve o cambia el orden
// callback `signIn` → login, este test falla, y eso es lo que se busca (E8 depende de ese orden).
import { handleLoginOrRegister } from "../../node_modules/@auth/core/lib/actions/callback/handle-login.js";

/**
 * Contrato con Auth.js para apagar `allowDangerousEmailAccountLinking` (E8, ADR-024): con el flag en `false`, un `User` que ya existe y NO tiene cuenta de Google
 * no puede entrar (`OAuthAccountNotLinked`), salvo que la `Account` ya esté creada antes (la crea el callback `signIn` al aceptar una invitación). Un email
 * nuevo no choca con nada. Un `User` con otra cuenta de Google tampoco entra.
 */
const EMAIL = "contrato-authjs@gmail.com";
const adapter = PrismaAdapter(prismaAdmin);

const opciones = {
  adapter,
  jwt: {},
  events: {},
  session: { strategy: "database", maxAge: 3600, generateSessionToken: () => `sesion-${Math.random().toString(36).slice(2)}` },
  provider: { id: "google", account: (tokens: object) => tokens, allowDangerousEmailAccountLinking: false },
  cookies: { sessionToken: { name: "x" } },
};

const cuenta = (sub: string) => ({ type: "oidc", provider: "google", providerAccountId: sub, access_token: "a", id_token: "i" });
const perfil = { id: "ignorado", email: EMAIL, name: "Prueba" };
const entrar = (sub: string) => handleLoginOrRegister(undefined as never, perfil, cuenta(sub) as never, opciones as never);

async function limpiar() {
  const u = await prismaAdmin.user.findUnique({ where: { email: EMAIL } });
  if (!u) return;
  await prismaAdmin.session.deleteMany({ where: { userId: u.id } });
  await prismaAdmin.account.deleteMany({ where: { userId: u.id } });
  await prismaAdmin.user.delete({ where: { id: u.id } });
}

beforeEach(limpiar);
afterEach(limpiar);

describe("Auth.js con allowDangerousEmailAccountLinking en false", () => {
  it("un User precargado sin cuenta de Google NO entra: OAuthAccountNotLinked, y no se crea ninguna cuenta", async () => {
    await prismaAdmin.user.create({ data: { email: EMAIL } });
    await expect(entrar("sub-1")).rejects.toMatchObject({ type: "OAuthAccountNotLinked" });
    expect(await prismaAdmin.account.count({ where: { user: { email: EMAIL } } })).toBe(0);
  });

  it("si la Account ya está creada para ese User (la crea nuestro callback al aceptar la invitación), entra como el MISMO User y no crea otro", async () => {
    const u = await prismaAdmin.user.create({ data: { email: EMAIL } });
    await prismaAdmin.account.create({ data: { userId: u.id, type: "oidc", provider: "google", providerAccountId: "sub-1", id_token: "i" } });
    const r = await entrar("sub-1");
    expect(r.user.id).toBe(u.id);
    expect(r.session).toBeTruthy();
    expect(await prismaAdmin.user.count({ where: { email: EMAIL } })).toBe(1);
  });

  it("un email nuevo crea User y Account juntos, sin conflicto (la base de la invitación sin precarga)", async () => {
    const r = await entrar("sub-nuevo");
    expect(r.isNewUser).toBe(true);
    expect(await prismaAdmin.account.count({ where: { user: { email: EMAIL }, providerAccountId: "sub-nuevo" } })).toBe(1);
  });

  it("un User que ya tiene Google con otro sub NO entra con un sub distinto, aunque tenga el mismo email", async () => {
    const u = await prismaAdmin.user.create({ data: { email: EMAIL } });
    await prismaAdmin.account.create({ data: { userId: u.id, type: "oidc", provider: "google", providerAccountId: "sub-1", id_token: "i" } });
    await expect(entrar("sub-2")).rejects.toMatchObject({ type: "OAuthAccountNotLinked" });
    expect(await prismaAdmin.account.count({ where: { userId: u.id } })).toBe(1);
  });
});
