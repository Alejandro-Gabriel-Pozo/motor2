import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * `src/lib/auth.ts` (Auth.js) exporta lo que abre, lee o cierra una sesión. Cada nombre solo lo puede importar un puñado de archivos, a
 * propósito: la sesión se lee en UN lugar (`core/auth/session.ts`, que además la valida contra la base y el kill-switch de cuenta) y
 * abrir/cerrar sesión vive en el login y en los dos shells. Un archivo nuevo que importe `auth` para «leer rápido la sesión» se saltea
 * esa validación; uno que importe un nombre que acá no figura (p. ej. `unstable_update`) también falla: la lista es cerrada.
 * Para permitir un uso nuevo hay que agregarlo acá, con su motivo, y revisarlo.
 */
const RAIZ = join(__dirname, "../../src");

const PERMITIDOS: Record<string, string[]> = {
  auth: ["core/auth/session.ts"],
  handlers: ["app/api/auth/[...nextauth]/route.ts"],
  signIn: ["app/login/page.tsx"],
  signOut: ["app/login/page.tsx", "components/app-shell.tsx", "components/pos-shell.tsx"],
};

function archivos(dir: string, salida: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, e.name);
    if (e.isDirectory()) archivos(ruta, salida);
    else if (/\.(ts|tsx)$/.test(e.name)) salida.push(ruta);
  }
  return salida;
}

const apuntaALibAuth = (especificador: string) => /^(@\/lib\/auth|(\.{1,2}\/)+(lib\/)?auth)$/.test(especificador) && !especificador.includes("core/");

/** Nombres que `codigo` importa (o reexporta, o carga con `import()` / `require`) de `lib/auth`; `"*"` si trae todo el módulo. */
function importadosDeLibAuth(codigo: string, ruta: string): string[] {
  const fuente = ts.createSourceFile(ruta, codigo, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const nombres: string[] = [];
  const visitar = (n: ts.Node) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && apuntaALibAuth(n.moduleSpecifier.text)) {
      const clausula = n.importClause;
      if (!clausula) nombres.push("*");
      else {
        if (clausula.name) nombres.push("default");
        const enlaces = clausula.namedBindings;
        if (enlaces && ts.isNamespaceImport(enlaces)) nombres.push("*");
        else if (enlaces) for (const e of enlaces.elements) nombres.push((e.propertyName ?? e.name).text);
      }
    } else if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier) && apuntaALibAuth(n.moduleSpecifier.text)) {
      nombres.push("*");
    } else if (ts.isCallExpression(n)) {
      const arg = n.arguments[0];
      const cargaDinamica = n.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(n.expression) && n.expression.text === "require");
      if (cargaDinamica && arg && ts.isStringLiteralLike(arg) && apuntaALibAuth(arg.text)) nombres.push("*");
    }
    ts.forEachChild(n, visitar);
  };
  visitar(fuente);
  return nombres;
}

describe("lib/auth solo se importa desde sus puntos de uso", () => {
  it("el detector ve cada forma de importar (sanidad: no pasa en vacío)", () => {
    expect(importadosDeLibAuth(`import { auth, signOut as salir } from "@/lib/auth";`, "a.ts")).toEqual(["auth", "signOut"]);
    expect(importadosDeLibAuth(`import * as a from "../../lib/auth";`, "a.ts")).toEqual(["*"]);
    expect(importadosDeLibAuth(`const m = await import("@/lib/auth");`, "a.ts")).toEqual(["*"]);
    expect(importadosDeLibAuth(`export { auth } from "@/lib/auth";`, "a.ts")).toEqual(["*"]);
    expect(importadosDeLibAuth(`import { auth } from "@/core/auth/session";`, "a.ts")).toEqual([]);
  });

  it("la tabla de permitidos apunta a archivos que existen y que de verdad importan ese nombre", () => {
    for (const [nombre, rutas] of Object.entries(PERMITIDOS)) {
      for (const rel of rutas) {
        const importados = importadosDeLibAuth(readFileSync(join(RAIZ, rel), "utf8"), rel);
        expect(importados, `${rel} ya no importa ${nombre} de lib/auth: sacalo de PERMITIDOS`).toContain(nombre);
      }
    }
  });

  it("cada importación de lib/auth está en la tabla de permitidos (lista cerrada)", () => {
    const sobrantes: string[] = [];
    for (const archivo of archivos(RAIZ)) {
      const rel = relative(RAIZ, archivo).replace(/\\/g, "/");
      if (rel === "lib/auth.ts") continue;
      for (const nombre of importadosDeLibAuth(readFileSync(archivo, "utf8"), rel)) {
        if (!(PERMITIDOS[nombre] ?? []).includes(rel)) sobrantes.push(`${rel} importa «${nombre}» de lib/auth`);
      }
    }
    expect(sobrantes, "leé la sesión con getUsuarioActual (core/auth/session.ts); un uso nuevo se agrega a PERMITIDOS con su motivo").toEqual([]);
  });
});
