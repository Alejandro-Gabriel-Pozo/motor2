import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Hito 3, B3-10 de `docs/plan-hito-3-pureza.md`: TODO camino de un token de invitación a la base verifica antes el rol de ejecución (ADR-022). La lectura por token
 * (`dbDeInvitacion`, política `lectura_por_token`) y la base de la empresa de la invitación (`invitacionConSuBase`) corren SIN sesión ni contexto: es el mismo riesgo que la
 * carta pública (`publica-sin-sesion-verifica-el-rol.test.ts`). Si el rol de la base saltara el RLS y hubiera más de una empresa, `verificarRolDeEjecucionDelProceso` se niega y
 * NADA llega a pedir una base. Antes de B3 lo hacía `core/auth/invitacion.ts`; ahora la puerta es `server/sesion/invitacion.ts` y la usan el gate de login, la vinculación de la
 * cuenta de Google y los dos casos de uso de aceptar. Dos controles:
 *  1. de comportamiento: con el verificador rechazando, cada entrada (lectura, puerta, gate, vinculación y los dos casos de uso) rechaza y no se pidió ninguna base;
 *  2. estructural, por AST: en `invitacionDelToken` la verificación va ANTES de `dbDeInvitacion`, y en `invitacionConSuBase` la invitación se lee (con
 *     `invitacionDelToken`) ANTES de pedir la base de su empresa. Que esas sean las únicas puertas a las fábricas de bases lo fija `server-sesion.test.ts` (PUERTAS_A_LA_BASE).
 */
const { verificar, dbDeInvitacion, dbDeEmpresa, transaccionDeLaEmpresa } = vi.hoisted(() => ({
  verificar: vi.fn(async () => undefined),
  dbDeInvitacion: vi.fn(() => ({ invitacion: { findFirst: async () => null }, empresa: { findUnique: async () => null } })),
  dbDeEmpresa: vi.fn(() => ({})),
  transaccionDeLaEmpresa: vi.fn(() => async () => undefined),
}));
vi.mock("@/core/auth/base", () => ({ verificarRolDeEjecucionDelProceso: verificar, dbDeInvitacion, dbDeEmpresa, transaccionDeLaEmpresa }));

import { invitacionConSuBase, invitacionDelToken, invitacionHabilitaElIngreso } from "@/server/sesion/invitacion";
import { vincularCuentaConInvitacion } from "@/server/sesion/vincular-cuenta";
import { aceptarInvitacionDeGerenteCasoDeUso } from "@/server/actions/auth/casos-de-uso/aceptar-invitacion-de-gerente";
import { aceptarInvitacionDeUsuarioCasoDeUso } from "@/server/actions/auth/casos-de-uso/aceptar-invitacion-de-usuario";

const TOKEN = "t".repeat(43);
const AHORA = new Date(0);
const USUARIO = { id: "u1", email: "a@b.com" };
const ARCHIVO = join(__dirname, "../../src/server/sesion/invitacion.ts");

describe("la invitación verifica el rol de ejecución antes de tocar la base", () => {
  beforeEach(() => vi.clearAllMocks());

  it("con el rol rechazado, ninguna entrada llega a pedir una base", async () => {
    verificar.mockRejectedValue(new Error("rol privilegiado con más de una empresa"));
    const entradas = [
      () => invitacionDelToken(TOKEN, AHORA),
      () => invitacionConSuBase(TOKEN, AHORA),
      () => invitacionHabilitaElIngreso(TOKEN, USUARIO.email, AHORA),
      () => vincularCuentaConInvitacion({ token: TOKEN, usuario: USUARIO, cuenta: { providerAccountId: "g1" }, ahora: AHORA }),
      () => aceptarInvitacionDeGerenteCasoDeUso({ token: TOKEN, usuario: USUARIO, cuit: "30-50000000-3", ahora: AHORA }),
      () => aceptarInvitacionDeUsuarioCasoDeUso({ token: TOKEN, usuario: USUARIO, ahora: AHORA }, async () => ({ ok: true })),
    ];
    for (const entrar of entradas) await expect(entrar()).rejects.toThrow(/rol privilegiado/);
    expect(verificar).toHaveBeenCalledTimes(entradas.length);
    for (const fabrica of [dbDeInvitacion, dbDeEmpresa, transaccionDeLaEmpresa]) expect(fabrica).not.toHaveBeenCalled();
    verificar.mockResolvedValue(undefined);
  });

  it("con el rol aceptado, lee por el hash (sanidad: el control no pasa en vacío)", async () => {
    expect(await invitacionConSuBase(TOKEN, AHORA)).toBeNull();
    expect(verificar).toHaveBeenCalledTimes(1);
    expect(dbDeInvitacion).toHaveBeenCalledTimes(1);
    expect(dbDeEmpresa).not.toHaveBeenCalled();
  });

  it("un token mal formado ni siquiera llega a verificar (no hay nada que leer)", async () => {
    expect(await invitacionDelToken("corto", AHORA)).toBeNull();
    expect(verificar).not.toHaveBeenCalled();
  });

  it("por AST: la verificación antes de la base por hash, y la invitación antes de la base de su empresa", () => {
    expect(ordenDeLlamadas(readFileSync(ARCHIVO, "utf8"))).toEqual({
      invitacionDelToken: ["verificarRolDeEjecucionDelProceso", "dbDeInvitacion"],
      invitacionConSuBase: ["invitacionDelToken", "dbDeEmpresa", "transaccionDeLaEmpresa"],
    });
  });

  it("el detector de orden (con fuentes sintéticas)", () => {
    const malo = "export async function invitacionDelToken(t: string) { const db = dbDeInvitacion(t); await verificarRolDeEjecucionDelProceso(); }";
    expect(ordenDeLlamadas(malo).invitacionDelToken).toEqual(["dbDeInvitacion", "verificarRolDeEjecucionDelProceso"]);
    const sinLeer = "export async function invitacionConSuBase(t: string, e: string) { return { db: dbDeEmpresa(e), tx: transaccionDeLaEmpresa(e) }; }";
    expect(ordenDeLlamadas(sinLeer).invitacionConSuBase).toEqual(["dbDeEmpresa", "transaccionDeLaEmpresa"]);
  });
});

const OBSERVADAS = new Set(["verificarRolDeEjecucionDelProceso", "dbDeInvitacion", "invitacionDelToken", "dbDeEmpresa", "transaccionDeLaEmpresa"]);

/** En `invitacionDelToken` e `invitacionConSuBase`, las llamadas observadas en el orden en que aparecen en el código. */
function ordenDeLlamadas(codigo: string): Record<string, string[]> {
  const fuente = ts.createSourceFile("invitacion.ts", codigo, ts.ScriptTarget.Latest, true);
  const orden: Record<string, string[]> = {};
  for (const st of fuente.statements) {
    if (!ts.isFunctionDeclaration(st) || !st.name || !["invitacionDelToken", "invitacionConSuBase"].includes(st.name.text)) continue;
    const llamadas: string[] = [];
    const visitar = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && OBSERVADAS.has(n.expression.text)) llamadas.push(n.expression.text);
      ts.forEachChild(n, visitar);
    };
    if (st.body) visitar(st.body);
    orden[st.name.text] = llamadas;
  }
  return orden;
}
