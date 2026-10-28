import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, normalize, relative, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * El contexto de actor SIN SESIÓN (`src/server/sesion/contexto-de-comando.ts`) solo lo importa el comando de un solo uso del importador del catálogo (docs/diseno-importador-de-catalogo-2026-10-28.md
 * §8, «punto delicado»: «una función nueva `server-only` en `src/server/sesion/` y un guardián que solo permita importarla desde `scripts/importar-catalogo.ts`»). Arma un `ContextoUsuario` con un
 * correo, sin cookie ni sesión: desde una pantalla, una Server Action, una consulta o la consola sería saltear el login. En todo el repositorio (src, scripts, test, prisma, plataforma) los que
 * la importan (import, export…from, `import()` o `vi.mock`) son EXACTAMENTE los de `IMPORTADORES` (el comando y su prueba), en las dos direcciones.
 * Mutación: importarla desde otro archivo (una Server Action, un script) → rojo; sacar el import del comando → rojo.
 */
const RAIZ = join(__dirname, "../..");
const MODULO = "src/server/sesion/contexto-de-comando";
const IMPORTADORES: Record<string, string> = {
  "scripts/importar-catalogo.ts": "El comando de un solo uso del importador (D1 del dueño): arma el actor de `--actor` sobre la empresa de `--empresa`.",
  "test/catalogo/importacion/contexto-de-comando.test.ts": "La prueba de la función (contra Postgres real): quién es actor y quién no.",
};

const CARPETAS = ["src", "scripts", "test", "prisma", "plataforma/src"];
const EXCLUIDAS = new Set(["node_modules", ".next", "migrations"]);

function fuentes(dir: string): string[] {
  return readdirSync(join(RAIZ, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) return EXCLUIDAS.has(e.name) ? [] : fuentes(rel);
    return /\.(ts|tsx|mts|mjs)$/.test(e.name) ? [rel] : [];
  });
}

/** Los especificadores que importa un fuente: import/export…from, `import("…")`, `require("…")` y el primer argumento de `vi.mock`/`vi.doMock`. */
export function especificadoresDe(codigo: string): string[] {
  const sf = ts.createSourceFile("x.ts", codigo, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const salida: string[] = [];
  const visitar = (n: ts.Node): void => {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) salida.push(n.moduleSpecifier.text);
    if (ts.isCallExpression(n) && n.arguments[0] && ts.isStringLiteralLike(n.arguments[0])) {
      const e = n.expression;
      const nombre = e.kind === ts.SyntaxKind.ImportKeyword ? "import" : ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : "";
      if (["import", "require", "mock", "doMock"].includes(nombre)) salida.push(n.arguments[0].text);
    }
    ts.forEachChild(n, visitar);
  };
  visitar(sf);
  return salida;
}

/** ¿El especificador, desde `archivo`, apunta al módulo del contexto de comando? (alias `@/` o relativo, con o sin extensión). */
export function apuntaAlModulo(archivo: string, especificador: string): boolean {
  const destino = especificador.startsWith("@/") ? `src/${especificador.slice(2)}` : especificador.startsWith(".") ? relative(RAIZ, normalize(join(RAIZ, dirname(archivo), especificador))) : null;
  return destino !== null && destino.split(sep).join("/").replace(/\.tsx?$/, "") === MODULO;
}

describe("el contexto de actor sin sesión solo lo importa el comando del importador", () => {
  it("los importadores son exactamente los declarados (con su motivo)", () => {
    const reales = CARPETAS.flatMap(fuentes)
      .filter((r) => especificadoresDe(readFileSync(join(RAIZ, r), "utf8")).some((e) => apuntaAlModulo(r, e)))
      .sort();
    expect(reales).toEqual(Object.keys(IMPORTADORES).sort());
    for (const [r, motivo] of Object.entries(IMPORTADORES)) expect(motivo.length, r).toBeGreaterThan(20);
  });

  it("el detector ve el alias, el relativo, el import dinámico y el vi.mock; un comentario no cuenta", () => {
    const ve = (archivo: string, codigo: string) => especificadoresDe(codigo).some((e) => apuntaAlModulo(archivo, e));
    expect(ve("src/server/actions/x.ts", 'import { a } from "@/server/sesion/contexto-de-comando";')).toBe(true);
    expect(ve("scripts/otro.ts", 'import { a } from "../src/server/sesion/contexto-de-comando";')).toBe(true);
    expect(ve("test/x/y.test.ts", 'const m = await import("../../src/server/sesion/contexto-de-comando.ts");')).toBe(true);
    expect(ve("test/x/y.test.ts", 'vi.mock("../../src/server/sesion/contexto-de-comando", () => ({}));')).toBe(true);
    expect(ve("src/x.ts", '// import { a } from "@/server/sesion/contexto-de-comando";\nimport { b } from "@/server/sesion/contexto";')).toBe(false);
  });
});
