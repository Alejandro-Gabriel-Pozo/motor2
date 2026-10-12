import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Regla de arquitectura: LAS FUENTES SALEN DEL REPOSITORIO, NUNCA DE GOOGLE EN EL BUILD (`next/font/local`, no `next/font/google`).
 *
 * `next/font/google` baja el CSS y los woff2 de fonts.googleapis.com / fonts.gstatic.com EN CADA BUILD. Un fallo de red del runner (pasó una vez en CI:
 * «module not found» de «Cormorant Garamond», que tumbó el job de ZAP) tumbaría igual un build de Vercel. Las tipografías de la app (Geist, Geist Mono y las
 * de la carta pública: Playfair Display, Lora, Cormorant Garamond y Montserrat) viven en `src/fonts/` con su licencia OFL y se cargan con `next/font/local`.
 *
 * Qué comprueba (AST, fuera de los comentarios): ningún `import`, `export … from`, `import()` ni `require()` de `next/font/google` en `src/` ni en `plataforma/`.
 */
const RAIZ = join(__dirname, "../..");
const MODULO_PROHIBIDO = "next/font/google";

function modulosImportados(codigo: string, ruta: string): string[] {
  const fuente = ts.createSourceFile(ruta, codigo, ts.ScriptTarget.Latest, true, ruta.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const modulos: string[] = [];
  const visitar = (nodo: ts.Node): void => {
    if ((ts.isImportDeclaration(nodo) || ts.isExportDeclaration(nodo)) && nodo.moduleSpecifier && ts.isStringLiteral(nodo.moduleSpecifier)) modulos.push(nodo.moduleSpecifier.text);
    if (ts.isCallExpression(nodo) && nodo.arguments.length > 0 && ts.isStringLiteralLike(nodo.arguments[0])) {
      const esImportDinamico = nodo.expression.kind === ts.SyntaxKind.ImportKeyword;
      const esRequire = ts.isIdentifier(nodo.expression) && nodo.expression.text === "require";
      if (esImportDinamico || esRequire) modulos.push(nodo.arguments[0].text);
    }
    ts.forEachChild(nodo, visitar);
  };
  visitar(fuente);
  return modulos;
}

function archivosDe(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return nombre === "node_modules" || nombre === ".next" ? [] : archivosDe(ruta);
    return /\.tsx?$/.test(nombre) && !nombre.endsWith(".d.ts") ? [ruta] : [];
  });
}

describe("fuentes desde el repo: el detector ve las violaciones (la regla no puede quedar ciega)", () => {
  const google = (codigo: string) => modulosImportados(codigo, "x.ts").filter((m) => m === MODULO_PROHIBIDO);

  it("detecta import, reexport, import dinámico y require de next/font/google", () => {
    expect(google('import { Lora } from "next/font/google";')).toEqual([MODULO_PROHIBIDO]);
    expect(google('export { Lora } from "next/font/google";')).toEqual([MODULO_PROHIBIDO]);
    expect(google('export const f = () => import("next/font/google");')).toEqual([MODULO_PROHIBIDO]);
    expect(google('const g = require("next/font/google");')).toEqual([MODULO_PROHIBIDO]);
  });

  it("no marca next/font/local ni un texto que nombra el módulo", () => {
    expect(google('import localFont from "next/font/local";')).toEqual([]);
    expect(google('// import { Lora } from "next/font/google"\nexport const t = "next/font/google";')).toEqual([]);
  });
});

describe("fuentes desde el repo: el código del repositorio", () => {
  const archivos = ["src", "plataforma"].flatMap((c) => archivosDe(join(RAIZ, c)));

  it("encuentra el código de src/ y plataforma/ (si deja de encontrarse, la regla quedó vacía)", () => {
    expect(archivos.length).toBeGreaterThan(500);
  });

  it("ningún archivo importa next/font/google", () => {
    const violaciones = archivos.flatMap((absoluta) => {
      const ruta = relative(RAIZ, absoluta).split(sep).join("/");
      return modulosImportados(readFileSync(absoluta, "utf8"), ruta)
        .filter((m) => m === MODULO_PROHIBIDO)
        .map((m) => `${ruta}  importa  ${m}`);
    });
    expect(violaciones, `Las fuentes salen de src/fonts/ con next/font/local: el build no puede depender de fonts.googleapis.com\n${violaciones.join("\n")}`).toEqual([]);
  });
});
