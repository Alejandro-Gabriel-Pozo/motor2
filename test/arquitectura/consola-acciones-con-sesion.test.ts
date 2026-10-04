import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";

/**
 * Las Server Actions de la consola (E5, ADR-020) son endpoints POST públicos: cualquiera que conozca su identificador puede invocarlas. Su único control de
 * acceso es la sesión del administrador (con segundo factor), así que TODA acción exportada de un archivo `"use server"` de `plataforma/src/app/**` abre con
 * `administradorEnSesion()` —directo o por `autorYDependencias()`, que lo hace primero— antes de tocar la base. Las del login son la excepción: son previas a la sesión.
 *
 * Mutación: sacar esa llamada de una acción pone este test en rojo.
 */
const RAIZ = join(__dirname, "../..");
const APP = join(RAIZ, "plataforma/src/app");
const PREVIAS_A_LA_SESION = ["login/"];
const ABRE_CON_SESION = new Set(["administradorEnSesion", "autorYDependencias"]);

function archivos(dir: string, salida: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, e.name);
    if (e.isDirectory()) archivos(ruta, salida);
    else if (/\.ts$/.test(e.name)) salida.push(ruta);
  }
  return salida;
}

/** ¿La primera sentencia del cuerpo contiene (a cualquier profundidad) una llamada a alguna de las funciones que abren con sesión? */
function abreConSesion(cuerpo: ts.Block): boolean {
  const primera = cuerpo.statements[0];
  if (!primera) return false;
  let encontrada = false;
  const visitar = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && ABRE_CON_SESION.has(n.expression.text)) encontrada = true;
    ts.forEachChild(n, visitar);
  };
  visitar(primera);
  return encontrada;
}

function accionesSinSesion(nombreDeArchivo: string, fuente: string): string[] {
  const sf = ts.createSourceFile(nombreDeArchivo, fuente, ts.ScriptTarget.Latest, true);
  const primera = sf.statements[0];
  if (!primera || !ts.isExpressionStatement(primera) || !ts.isStringLiteral(primera.expression) || primera.expression.text !== "use server") return [];
  const problemas: string[] = [];
  for (const s of sf.statements) {
    if (!ts.isFunctionDeclaration(s) || !s.name) continue;
    const exportada = (ts.getModifiers(s) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    const esAyudante = ABRE_CON_SESION.has(s.name.text);
    if (esAyudante) {
      if (!s.body || !abreConSesion(s.body)) problemas.push(`${s.name.text}: el ayudante que abre con sesión no la pide primero`);
      continue;
    }
    if (exportada && (!s.body || !abreConSesion(s.body))) problemas.push(`${s.name.text}: no abre con administradorEnSesion()`);
  }
  return problemas;
}

describe("consola: toda Server Action abre con la sesión del administrador", () => {
  const rutas = archivos(APP).map((r) => ({ ruta: relative(APP, r).replace(/\\/g, "/"), fuente: readFileSync(r, "utf8") }));
  const deAcciones = rutas.filter((r) => /^\s*["']use server["']/.test(r.fuente) && !PREVIAS_A_LA_SESION.some((p) => r.ruta.startsWith(p)));

  it("encuentra las acciones de empresas (sanidad: no pasa en vacío)", () => {
    expect(deAcciones.map((a) => a.ruta)).toContain("empresas/acciones.ts");
  });

  it.each(deAcciones.map((a) => [a.ruta, a.fuente]))("%s: ninguna acción exportada queda sin sesión", (ruta, fuente) => {
    expect(accionesSinSesion(ruta, fuente)).toEqual([]);
  });

  it("el detector reconoce una acción sin sesión y una con sesión", () => {
    const sin = '"use server";\nexport async function hacer() {\n  const x = await db();\n  return x;\n}\n';
    const con = '"use server";\nexport async function hacer() {\n  const { autor } = await autorYDependencias();\n  return autor;\n}\nasync function autorYDependencias() {\n  const a = await administradorEnSesion();\n  return a;\n}\n';
    expect(accionesSinSesion("a.ts", sin)).toEqual(["hacer: no abre con administradorEnSesion()"]);
    expect(accionesSinSesion("a.ts", con)).toEqual([]);
    expect(accionesSinSesion("a.ts", "export async function libre() {}")).toEqual([]);
  });
});
