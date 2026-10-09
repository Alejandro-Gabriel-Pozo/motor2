import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, prismaAdmin } from "../setup/test-db";
import { decidirInicioDeSesion } from "../../src/server/sesion/acceso";
import { incorporarPrimerGerente } from "../../src/server/actions/auth/casos-de-uso/incorporar-primer-gerente-en-tx";
import { asegurarInvitacionDeVinculacion } from "../../src/server/actions/auth/casos-de-uso/invitaciones-de-usuario-en-tx";
import { sembrarEmpresa } from "../../plataforma/src/servidor/sembrar-empresa";
import { generarTokenOpaco, hashDeToken } from "../../src/core/seguridad/tokens";
import { azarDelProceso } from "../../src/lib/azar";

/**
 * S-17 / D5 (T8 del endurecimiento): al retirar el login por dominio de Google Workspace, los DOS caminos legítimos del PRIMER gerente tienen que seguir funcionando de punta a punta en
 * el gate de `signIn` (`decidirInicioDeSesion`): el bootstrap local (`prisma/seed.ts --gerente`: crea el `User`, lo incorpora como gerente con `incorporarPrimerGerente` y le deja una
 * invitación de vinculación) y el de producción (la invitación de gerente que deja la consola, a un email que todavía no tiene `User`). Con base real.
 */
const EMAIL = "primer.gerente@gmail.com";
const cuenta = { providerAccountId: "google-primer-gerente", type: "oidc", access_token: "a", id_token: "id-token-de-prueba" };

const entrar = (tokenDeInvitacion: string | undefined) =>
  decidirInicioDeSesion({ emailUsuario: EMAIL, emailPerfil: EMAIL, emailVerificado: true, tokenDeSesionAbierta: undefined, tokenDeInvitacion, cuenta });

async function empresaSembrada(id: string, estado: "ACTIVE" | "PROVISIONING") {
  await prismaAdmin.empresa.create({ data: { id, nombre: `Empresa ${id}`, slug: id, zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado } });
  await prismaAdmin.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.empresa_id', ${id}, true)`;
    await sembrarEmpresa(tx, id, "Central");
  });
}

beforeEach(() => limpiarBaseDeTest());
afterAll(() => prismaAdmin.$disconnect());

describe("el primer gerente sigue entrando sin la vía por dominio", () => {
  it("bootstrap local (seed --gerente): User + incorporarPrimerGerente + invitación de vinculación → entra y vincula su cuenta; sin la invitación no", async () => {
    await empresaSembrada("local", "ACTIVE");
    const usuario = await prismaAdmin.user.create({ data: { email: EMAIL } });
    await prismaAdmin.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.empresa_id', 'local', true)`;
      expect(await incorporarPrimerGerente(tx, { empresaId: "local", usuarioId: usuario.id })).toMatchObject({ ok: true });
    });
    const invitacion = await prismaAdmin.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.empresa_id', 'local', true)`;
      return asegurarInvitacionDeVinculacion(tx, { empresaId: "local", email: EMAIL, invitadoPorId: usuario.id, ahora: new Date(), azar: azarDelProceso });
    });
    if (!invitacion.ok || !invitacion.token) throw new Error("no se pudo armar la invitación de vinculación del seed");

    // Existe, tiene membresía activa (pasa el gate) y no tiene Google: sin el enlace de vinculación no entra (E8); con él, sí, y queda su cuenta de Google.
    expect(await entrar(undefined)).toBe("/login?aviso=falta-invitacion");
    expect(await entrar(invitacion.token)).toBe(true);
    expect(await prismaAdmin.account.count({ where: { userId: usuario.id, provider: "google" } })).toBe(1);
    // Ya vinculada, vuelve a entrar sin invitación.
    expect(await entrar(undefined)).toBe(true);
  });

  it("producción (consola): la invitación de gerente de una empresa en alta le abre la entrada a un email que todavía no existe, y solo con su token", async () => {
    await empresaSembrada("en-alta", "PROVISIONING");
    const token = generarTokenOpaco(azarDelProceso);
    await prismaAdmin.invitacion.create({ data: { empresaId: "en-alta", email: EMAIL, rolEmpresa: "gerente", hashToken: hashDeToken(token), venceEn: new Date(Date.now() + 3_600_000) } });

    expect(await entrar(undefined)).toBe(false);
    expect(await entrar(generarTokenOpaco(azarDelProceso))).toBe(false);
    expect(await entrar(token)).toBe(true);
    // El gate solo deja llegar a la pantalla de aceptación: no crea nada (Auth.js crea el `User` recién cuando el callback devuelve `true`).
    expect(await prismaAdmin.user.count({ where: { email: EMAIL } })).toBe(0);
  });
});
