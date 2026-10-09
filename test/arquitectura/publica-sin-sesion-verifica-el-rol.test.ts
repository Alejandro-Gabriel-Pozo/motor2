import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El camino con sesión (`obtenerContextoUsuario`) se niega a operar si el rol de la base salta el RLS y hay más de una empresa. La carta
 * pública (sin sesión) es el camino más expuesto: sus funciones (`server/carta-publica/sin-sesion.ts`) tienen que pasar por la misma
 * verificación. Dos controles: (1) de comportamiento, con el verificador rechazando; (2) estructural, por AST: toda exportación del
 * archivo es una función cuyo cuerpo es `conRolVerificado(...)`, así una exportación nueva que se olvide del chequeo falla.
 */
const { verificar, resolverEmpresaCarta, resolverPortalCarta, resolverConfigPortal, resolverCartaPublica } = vi.hoisted(() => ({
  verificar: vi.fn(async () => undefined),
  resolverEmpresaCarta: vi.fn(async () => null),
  resolverPortalCarta: vi.fn(async () => []),
  resolverConfigPortal: vi.fn(async () => ({})),
  resolverCartaPublica: vi.fn(async () => null),
}));
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/core/auth/base", () => ({ dbDeEmpresa: () => ({}), verificarRolDeEjecucionDelProceso: verificar }));
vi.mock("@/server/lecturas/carta/empresa", () => ({ resolverEmpresaCarta }));
vi.mock("@/server/lecturas/carta/publica", () => ({ resolverPortalCarta, resolverConfigPortal, resolverCartaPublica }));

import * as publica from "@/server/carta-publica/sin-sesion";

const EMPRESA = { id: "e1", slug: "e1", nombre: "E1" };
const ARCHIVO = join(__dirname, "../../src/server/carta-publica/sin-sesion.ts");

describe("la carta pública sin sesión verifica el rol de la base", () => {
  beforeEach(() => vi.clearAllMocks());

  it("cada función exportada se niega a consultar si el rol de ejecución se rechaza", async () => {
    verificar.mockRejectedValue(new Error("rol privilegiado con más de una empresa"));
    const llamadas = [
      () => publica.empresaCartaPublica("x"),
      () => publica.portalCartaPublico(EMPRESA),
      () => publica.configPortalPublica(EMPRESA),
      () => publica.cartaPublica(EMPRESA, "central", new Date()),
    ];
    expect(llamadas).toHaveLength(Object.keys(publica).length);
    for (const llamar of llamadas) await expect(llamar()).rejects.toThrow(/rol privilegiado/);
    for (const consulta of [resolverEmpresaCarta, resolverPortalCarta, resolverConfigPortal, resolverCartaPublica]) expect(consulta).not.toHaveBeenCalled();
    verificar.mockResolvedValue(undefined);
  });

  it("con el rol aceptado, consulta", async () => {
    await publica.empresaCartaPublica("x");
    expect(verificar).toHaveBeenCalledTimes(1);
    expect(resolverEmpresaCarta).toHaveBeenCalledTimes(1);
  });

  it("toda exportación del archivo es una función que delega en conRolVerificado (lista cerrada, por AST)", () => {
    const fuente = ts.createSourceFile(ARCHIVO, readFileSync(ARCHIVO, "utf8"), ts.ScriptTarget.Latest, true);
    const sinChequeo: string[] = [];
    let exportadas = 0;
    for (const s of fuente.statements) {
      const exportada = ts.canHaveModifiers(s) && ts.getModifiers(s)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      if (!exportada) continue;
      if (!ts.isVariableStatement(s)) {
        sinChequeo.push(`${s.getText(fuente).slice(0, 40)}: solo se exportan constantes con función flecha`);
        continue;
      }
      for (const d of s.declarationList.declarations) {
        exportadas++;
        const f = d.initializer;
        const cuerpo = f && ts.isArrowFunction(f) ? f.body : undefined;
        const delega = cuerpo && ts.isCallExpression(cuerpo) && ts.isIdentifier(cuerpo.expression) && cuerpo.expression.text === "conRolVerificado";
        if (!delega) sinChequeo.push(d.name.getText(fuente));
      }
    }
    expect(exportadas).toBeGreaterThan(0);
    expect(sinChequeo, "envolvé la consulta en conRolVerificado(() => ...)").toEqual([]);
  });
});
