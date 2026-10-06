import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";

/**
 * Las Server Actions de la consola (E5, ADR-020) son endpoints POST públicos: cualquiera que conozca su identificador puede invocarlas. Su único control de
 * acceso es la sesión del administrador (con segundo factor), así que TODA acción exportada de un archivo `"use server"` de `plataforma/src/app/**` abre con
 * `administradorEnSesion()` —directo o por `contextoDeAccion(instalacionId)`, que lo hace primero— antes de tocar la base. Desde ADR-025 las de `instalaciones/**` además reciben la
 * instalación como PRIMER parámetro y se la pasan a `contextoDeAccion` (nunca un literal): una pestaña desactualizada no puede operar sobre otra instalación. Las del login son la excepción: son previas a la sesión.
 *
 * Mutación: sacar esa llamada de una acción pone este test en rojo.
 */
const RAIZ = join(__dirname, "../..");
const APP = join(RAIZ, "plataforma/src/app");
const PREVIAS_A_LA_SESION = ["login/"];
const ABRE_CON_SESION = new Set(["administradorEnSesion", "contextoDeAccion"]);

function archivos(dir: string, salida: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, e.name);
    if (e.isDirectory()) archivos(ruta, salida);
    else if (/\.tsx?$/.test(e.name)) salida.push(ruta);
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

/** ¿La primera sentencia llama `contextoDeAccion(<primer parámetro>)`? Con el parámetro como identificador: ni un literal ni otra variable. */
function pasaLaInstalacion(s: ts.FunctionDeclaration): boolean {
  const primero = s.parameters[0];
  const primera = s.body?.statements[0];
  if (!primero || !ts.isIdentifier(primero.name) || !primera) return false;
  let ok = false;
  const visitar = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "contextoDeAccion" && n.arguments.length === 1) {
      const arg = n.arguments[0];
      if (ts.isIdentifier(arg) && arg.text === (primero.name as ts.Identifier).text) ok = true;
    }
    ts.forEachChild(n, visitar);
  };
  visitar(primera);
  return ok;
}

function accionesSinInstalacion(nombreDeArchivo: string, fuente: string): string[] {
  const sf = ts.createSourceFile(nombreDeArchivo, fuente, ts.ScriptTarget.Latest, true);
  const problemas: string[] = [];
  for (const s of sf.statements) {
    if (!ts.isFunctionDeclaration(s) || !s.name || !(ts.getModifiers(s) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
    if (!pasaLaInstalacion(s)) problemas.push(`${s.name.text}: no abre con contextoDeAccion(<su primer parámetro>)`);
  }
  return problemas;
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
    expect(deAcciones.map((a) => a.ruta)).toContain("instalaciones/[instalacion]/empresas/acciones.ts");
  });

  it.each(deAcciones.map((a) => [a.ruta, a.fuente]))("%s: ninguna acción exportada queda sin sesión", (ruta, fuente) => {
    expect(accionesSinSesion(ruta, fuente)).toEqual([]);
  });

  it.each(deAcciones.filter((a) => a.ruta.startsWith("instalaciones/")).map((a) => [a.ruta, a.fuente]))("%s: toda acción recibe la instalación primero y se la pasa a contextoDeAccion", (ruta, fuente) => {
    // Mutación: pasarle un literal (o no pasarle el parámetro) a contextoDeAccion pone este test en rojo.
    expect(accionesSinInstalacion(ruta, fuente)).toEqual([]);
  });

  it("toda página y layout de una instalación abre con contextoDePagina (sesión primero, instalación contra la lista)", () => {
    const paginas = archivos(APP).filter((r) => /instalaciones[\\/]\[instalacion\][\\/](.*[\\/])?(page|layout)\.tsx$/.test(r));
    expect(paginas.length).toBeGreaterThanOrEqual(5);
    for (const ruta of paginas) expect(readFileSync(ruta, "utf8"), relative(APP, ruta)).toContain("contextoDePagina(");
  });

  it("el detector de la instalación reconoce el parámetro, un literal y otra variable", () => {
    expect(accionesSinInstalacion("a.ts", "export async function a(inst: string) { const x = await contextoDeAccion(inst); return x; }")).toEqual([]);
    expect(accionesSinInstalacion("a.ts", 'export async function a(inst: string) { const x = await contextoDeAccion("zuluhub"); return x; }')).toHaveLength(1);
    expect(accionesSinInstalacion("a.ts", "export async function a(inst: string, otra: string) { const x = await contextoDeAccion(otra); return x; }")).toHaveLength(1);
    expect(accionesSinInstalacion("a.ts", "export async function a() { return 1; }")).toHaveLength(1);
  });

  it("el detector reconoce una acción sin sesión y una con sesión", () => {
    const sin = '"use server";\nexport async function hacer() {\n  const x = await db();\n  return x;\n}\n';
    const con = '"use server";\nexport async function hacer() {\n  const { autor } = await contextoDeAccion();\n  return autor;\n}\nasync function contextoDeAccion() {\n  const a = await administradorEnSesion();\n  return a;\n}\n';
    expect(accionesSinSesion("a.ts", sin)).toEqual(["hacer: no abre con administradorEnSesion()"]);
    expect(accionesSinSesion("a.ts", con)).toEqual([]);
    expect(accionesSinSesion("a.ts", "export async function libre() {}")).toEqual([]);
  });
});
