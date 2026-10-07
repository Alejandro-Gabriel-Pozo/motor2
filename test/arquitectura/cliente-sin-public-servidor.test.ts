import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";

/**
 * Un componente de cliente (`"use client"`) nunca importa la fachada de servidor de un dominio (`core/<dominio>/public-servidor.ts`) (Fase 2 del plan de pureza, auditoría de la Fase 2:
 * la convención estaba en el PR #72 y NINGÚN guardián la sostenía). La fachada `public.ts` es pura y sirve en el navegador; `public-servidor.ts` trae lecturas con la base
 * (`@/lib/db`, el runtime de Prisma) y, como `catalogo/public-servidor.ts` no lleva `server-only` a propósito (también lo importan scripts y Playwright), un import así NO falla en
 * el build: llevaría el cliente de Prisma al paquete del navegador, o reventaría recién en ejecución.
 *
 * Se mira el import DIRECTO del archivo con `"use client"` (también `import()` dinámico y `export … from`). No sigue cadenas (un módulo intermedio que importe la fachada de servidor
 * lo vigilan `fachadas-publicas-sin-io` y las reglas de capas). Lista de excepciones: vacía.
 */
const RAIZ = join(__dirname, "..", "..");
const EXCEPCIONES: Record<string, string> = {};

/** Los imports de `public-servidor` de un archivo, si ese archivo es de cliente (`"use client"` como primera sentencia). Devuelve `[]` si no es de cliente. */
export function importsDePublicServidorEnUnCliente(codigo: string): string[] {
  const archivo = ts.createSourceFile("x.tsx", codigo, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const primera = archivo.statements[0];
  const esDeCliente = !!primera && ts.isExpressionStatement(primera) && ts.isStringLiteral(primera.expression) && primera.expression.text === "use client";
  if (!esDeCliente) return [];
  const encontrados: string[] = [];
  const mira = (modulo: string) => {
    if (/(^|\/)public-servidor(\.tsx?)?$/.test(modulo)) encontrados.push(modulo);
  };
  const visitar = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) mira(n.moduleSpecifier.text);
    if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) mira(n.moduleSpecifier.text);
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && n.arguments[0] && ts.isStringLiteralLike(n.arguments[0])) mira(n.arguments[0].text);
    ts.forEachChild(n, visitar);
  };
  visitar(archivo);
  return encontrados;
}

function archivos(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const ruta = join(dir, e.name);
    return e.isDirectory() ? archivos(ruta) : /\.tsx?$/.test(e.name) ? [ruta] : [];
  });
}

describe("el detector de public-servidor en un componente de cliente ve lo que dice ver", () => {
  it("import de valor, import de tipo, reexport e import dinámico en un archivo de cliente", () => {
    const cliente = (cuerpo: string) => `"use client";\n${cuerpo}`;
    expect(importsDePublicServidorEnUnCliente(cliente('import { f } from "@/core/catalogo/public-servidor";'))).toEqual(["@/core/catalogo/public-servidor"]);
    expect(importsDePublicServidorEnUnCliente(cliente('import type { T } from "@/core/reportes/public-servidor";'))).toEqual(["@/core/reportes/public-servidor"]);
    expect(importsDePublicServidorEnUnCliente(cliente('export { f } from "../core/movimientos/public-servidor";'))).toEqual(["../core/movimientos/public-servidor"]);
    expect(importsDePublicServidorEnUnCliente(cliente('const m = () => import("@/core/stock/public-servidor");'))).toEqual(["@/core/stock/public-servidor"]);
  });

  it("la fachada pura, un archivo de servidor o un nombre parecido no cuentan", () => {
    expect(importsDePublicServidorEnUnCliente('"use client";\nimport { f } from "@/core/catalogo/public";')).toEqual([]);
    expect(importsDePublicServidorEnUnCliente('import { f } from "@/core/catalogo/public-servidor";')).toEqual([]); // no es de cliente
    expect(importsDePublicServidorEnUnCliente('"use client";\nimport { f } from "@/core/catalogo/mi-public-servidor-no";')).toEqual([]);
    expect(importsDePublicServidorEnUnCliente("// \"use client\"\nimport { f } from \"@/core/catalogo/public-servidor\";")).toEqual([]); // el comentario no es la directiva
  });
});

describe("ningún componente de cliente importa public-servidor", () => {
  const todos = [...archivos(join(RAIZ, "src", "app")), ...archivos(join(RAIZ, "src", "components")), ...archivos(join(RAIZ, "plataforma", "src"))].map((f) => relative(RAIZ, f).split(sep).join("/"));

  it("encuentra componentes de cliente (si no, la regla está vacía)", () => {
    const clientes = todos.filter((ruta) => /^\s*["']use client["']/.test(readFileSync(join(RAIZ, ruta), "utf8")));
    expect(clientes.length).toBeGreaterThan(50);
  });

  it("ninguno, salvo las excepciones declaradas con motivo (y la lista no tiene entradas de más)", () => {
    const infractores = todos.filter((ruta) => importsDePublicServidorEnUnCliente(readFileSync(join(RAIZ, ruta), "utf8")).length > 0 && !(ruta in EXCEPCIONES));
    expect(infractores, `Un componente de cliente no importa public-servidor (usá la fachada pura public.ts):\n${infractores.join("\n")}`).toEqual([]);
    const sobran = Object.keys(EXCEPCIONES).filter((ruta) => !todos.includes(ruta) || importsDePublicServidorEnUnCliente(readFileSync(join(RAIZ, ruta), "utf8")).length === 0);
    expect(sobran).toEqual([]);
  });
});
