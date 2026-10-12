import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El gate de login NO lee el reloj: usa la hora que le pasa el callback `signIn` (Fase 6, tramo c; O.227 de `docs/pureza-integracion.md`). Test PURO (sin base): la base y la invitación son dobles;
 * lo que se prueba es de dónde sale la hora. Una invitación (y una sesión abierta) que vencen en un instante `VENCE` dan una respuesta distinta según el `ahora` que se pasa, SIN tocar el reloj del
 * sistema: si el gate leyera `new Date()`, las dos llamadas darían lo mismo (el reloj real queda una hora ANTES de `VENCE`).
 */
const { prismaFalso, dbDeUsuarioFalsa, dbDeEmpresaFalsa, horasQueVioLaInvitacion, horasQueVioLaVinculacion } = vi.hoisted(() => ({
  prismaFalso: { user: { findUnique: vi.fn() }, session: { findUnique: vi.fn() } },
  dbDeUsuarioFalsa: vi.fn(),
  dbDeEmpresaFalsa: vi.fn(),
  horasQueVioLaInvitacion: [] as Date[],
  horasQueVioLaVinculacion: [] as Date[],
}));
const VENCE_EN_MS = Date.now() + 60 * 60 * 1000;

vi.mock("@/lib/db", () => ({ prisma: prismaFalso }));
vi.mock("@/server/sesion/base", () => ({ dbDeUsuario: dbDeUsuarioFalsa, dbDeEmpresa: dbDeEmpresaFalsa }));
// La invitación del doble vence en VENCE_EN_MS: habilita el ingreso solo si la hora RECIBIDA es anterior (lo mismo que hace el estado efectivo de la real).
vi.mock("@/server/sesion/invitacion", () => ({
  invitacionHabilitaElIngreso: async (_token: string | undefined, _email: string, ahora: Date) => {
    horasQueVioLaInvitacion.push(ahora);
    return ahora.getTime() < VENCE_EN_MS;
  },
}));
vi.mock("@/server/sesion/vincular-cuenta", () => ({
  vincularCuentaConInvitacion: async (entrada: { ahora: Date }) => {
    horasQueVioLaVinculacion.push(entrada.ahora);
    return true;
  },
}));

import { decidirInicioDeSesion, emailPuedeIniciarSesion, inicioDeSesionPermitido } from "../../src/server/sesion/acceso";

const VENCE = new Date(VENCE_EN_MS);
const ANTES_DE_VENCER = new Date(VENCE_EN_MS - 1000);
const DESPUES_DE_VENCER = new Date(VENCE_EN_MS + 1000);
const EMAIL = "invitado@gmail.com";
const cuenta = { providerAccountId: "sub-1", type: "oidc", id_token: "id-token-de-prueba" };

beforeEach(() => {
  vi.clearAllMocks();
  horasQueVioLaInvitacion.length = 0;
  horasQueVioLaVinculacion.length = 0;
  prismaFalso.user.findUnique.mockResolvedValue(null);
  prismaFalso.session.findUnique.mockResolvedValue(null);
  dbDeUsuarioFalsa.mockReturnValue({ usuarioEmpresa: { findMany: async () => [], count: async () => 0 } });
});

describe("el gate de login usa la hora recibida y no el reloj del sistema", () => {
  it("el reloj real queda antes del vencimiento (el supuesto del resto)", () => {
    expect(Date.now()).toBeLessThan(VENCE_EN_MS);
  });

  it("emailPuedeIniciarSesion: la misma invitación habilita antes de vencer y no después, según el `ahora` pasado", async () => {
    expect(await emailPuedeIniciarSesion(EMAIL, "token", ANTES_DE_VENCER)).toBe(true);
    expect(await emailPuedeIniciarSesion(EMAIL, "token", DESPUES_DE_VENCER)).toBe(false);
    expect(horasQueVioLaInvitacion).toEqual([ANTES_DE_VENCER, DESPUES_DE_VENCER]);
  });

  it("inicioDeSesionPermitido: la hora recibida decide si la sesión abierta de otro email sigue vigente y llega, la misma, a la invitación", async () => {
    prismaFalso.session.findUnique.mockResolvedValue({ expires: VENCE, user: { email: "otro@gmail.com" } });
    const entrada = { emailUsuario: EMAIL, emailPerfil: EMAIL, tokenDeSesionAbierta: "sesion-de-otro", tokenDeInvitacion: "token" };
    // Antes de que venza la sesión de OTRO email, no se puede entrar con esta cuenta (y ni se consulta la invitación).
    expect(await inicioDeSesionPermitido({ ...entrada, ahora: ANTES_DE_VENCER })).toBe(false);
    expect(horasQueVioLaInvitacion).toEqual([]);
    // Pasado el vencimiento esa sesión no cuenta: sigue la invitación, con la MISMA hora.
    expect(await inicioDeSesionPermitido({ ...entrada, ahora: DESPUES_DE_VENCER })).toBe(false);
    expect(horasQueVioLaInvitacion).toEqual([DESPUES_DE_VENCER]);
    // Y una hora anterior al vencimiento de la invitación, con la sesión de otro ya vencida, habilita: la sesión vence en un instante anterior al de la invitación.
    prismaFalso.session.findUnique.mockResolvedValue({ expires: new Date(VENCE_EN_MS - 5000), user: { email: "otro@gmail.com" } });
    expect(await inicioDeSesionPermitido({ ...entrada, ahora: ANTES_DE_VENCER })).toBe(true);
  });

  it("decidirInicioDeSesion: la misma hora llega a la invitación y a la vinculación, y da distinto resultado antes y después del vencimiento", async () => {
    prismaFalso.user.findUnique.mockResolvedValue({ id: "u1", email: EMAIL, activoGlobal: true, accounts: [] });
    const entrada = { emailUsuario: EMAIL, emailPerfil: EMAIL, emailVerificado: true, tokenDeSesionAbierta: undefined, tokenDeInvitacion: "token", cuenta };

    expect(await decidirInicioDeSesion({ ...entrada, ahora: ANTES_DE_VENCER })).toBe(true);
    expect(horasQueVioLaInvitacion[0]).toBe(ANTES_DE_VENCER);
    expect(horasQueVioLaVinculacion).toEqual([ANTES_DE_VENCER]);
    expect(horasQueVioLaVinculacion[0]).toBe(ANTES_DE_VENCER);

    expect(await decidirInicioDeSesion({ ...entrada, ahora: DESPUES_DE_VENCER })).toBe(false);
    expect(horasQueVioLaInvitacion[1]).toBe(DESPUES_DE_VENCER);
    expect(horasQueVioLaVinculacion).toHaveLength(1);
  });
});
