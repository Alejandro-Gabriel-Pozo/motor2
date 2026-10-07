import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Lecturas con SOLO sesión: lista cerrada (H8, trabajo D.1 de `pureza-integracion`; mapa en `docs/plan-hito-3-pureza.md` §5).
 *
 * Una Server Action de lectura es un endpoint que se puede invocar directo, sin pasar por la página que la usa. Las que abren con `requerirSesion()` o
 * `requerirSesionEnSucursal(id)` (src/server/actions/con-sesion.ts) le devuelven sus datos a CUALQUIER usuario logueado, aunque su rol no pueda abrir ninguna de
 * las pantallas que las consumen. Decisión del dueño (H8): cada una pasa a exigir el «Ver» de la pantalla consumidora (o el «O» de las claves de esas pantallas,
 * con `requerirVerAlguna`/`requerirVerAlgunaEnSucursal`). Durante la migración, las que quedaban con solo sesión eran EXACTAMENTE las de esta lista (18 al
 * empezar); cada commit de H8 sacó las que migraba. Desde H8-8 la lista está VACÍA y las dos guardas de solo sesión no se exportan (quedan como primer paso
 * interno de `con-sesion.ts`, antes de pedir el permiso): una lectura NUEVA con solo sesión pone esto en rojo, y también volver a exportarlas.
 *
 * Se mira por AST (no por texto): un comentario o un string que nombre la guarda no cuenta; una llamada anidada o sin `await`, sí. La implementación de las guardas
 * (`con-sesion.ts`) no entra en el recorrido: ahí `requerirSesion` es el primer paso de `requerirVer*`, no una lectura.
 */
const SRC = join(__dirname, "../../src");
const IMPLEMENTACION = "server/actions/con-sesion.ts";
const GUARDAS_DE_SOLO_SESION = new Set(["requerirSesion", "requerirSesionEnSucursal"]);

/** `archivo relativo a src/|función exportada que la llama` de cada lectura que todavía abre con solo sesión. Vacía desde H8-8 (y así se queda). */
const LECTURAS_CON_SOLO_SESION: readonly string[] = [];

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const ruta = join(dir, n);
    return statSync(ruta).isDirectory() ? archivos(ruta) : /\.tsx?$/.test(n) ? [ruta] : [];
  });
}

/** Nombre de la función de primer nivel (declaración o `const x = () =>`) que contiene al nodo, o `(módulo)` si está fuera de toda función. */
function funcionQueContiene(nodo: ts.Node): string {
  let actual: ts.Node | undefined = nodo;
  let nombre = "(módulo)";
  while (actual) {
    if (ts.isFunctionDeclaration(actual) && actual.name) nombre = actual.name.text;
    else if (ts.isVariableDeclaration(actual) && ts.isIdentifier(actual.name) && actual.initializer && (ts.isArrowFunction(actual.initializer) || ts.isFunctionExpression(actual.initializer)))
      nombre = actual.name.text;
    actual = actual.parent;
  }
  return nombre;
}

/** Cada llamada a una guarda de solo sesión del fuente, como `archivo|función que la contiene`. */
function llamadasDeSoloSesion(archivo: string, fuente: string): string[] {
  const sf = ts.createSourceFile(archivo, fuente, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const encontradas: string[] = [];
  const visitar = (nodo: ts.Node): void => {
    if (ts.isCallExpression(nodo) && ts.isIdentifier(nodo.expression) && GUARDAS_DE_SOLO_SESION.has(nodo.expression.text)) encontradas.push(`${archivo}|${funcionQueContiene(nodo)}`);
    ts.forEachChild(nodo, visitar);
  };
  visitar(sf);
  return encontradas;
}

const nombreDe = (ruta: string) => relative(SRC, ruta).split(sep).join("/");

describe("lecturas con solo sesión: lista cerrada (H8)", () => {
  it("las que abren con requerirSesion / requerirSesionEnSucursal son exactamente las de la lista (ni una más, ni una menos)", () => {
    const reales = archivos(SRC)
      .map((ruta) => [nombreDe(ruta), ruta] as const)
      .filter(([nombre]) => nombre !== IMPLEMENTACION)
      .flatMap(([nombre, ruta]) => llamadasDeSoloSesion(nombre, readFileSync(ruta, "utf8")));
    const sobran = reales.filter((r) => !LECTURAS_CON_SOLO_SESION.includes(r));
    const faltan = LECTURAS_CON_SOLO_SESION.filter((l) => !reales.includes(l));
    expect(sobran, `Lecturas NUEVAS con solo sesión (tienen que exigir el «Ver» de su pantalla, ver con-sesion.ts):\n${sobran.join("\n")}`).toEqual([]);
    expect(faltan, `Ya no abren con solo sesión: sacalas de LECTURAS_CON_SOLO_SESION:\n${faltan.join("\n")}`).toEqual([]);
    expect(new Set(reales).size, "una lectura llama dos veces a la guarda de solo sesión").toBe(reales.length);
  });

  it("con-sesion.ts no exporta las guardas de solo sesión (ninguna lectura las puede importar)", () => {
    const sf = ts.createSourceFile(IMPLEMENTACION, readFileSync(join(SRC, IMPLEMENTACION), "utf8"), ts.ScriptTarget.Latest, true);
    const exportadas = sf.statements
      .filter((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && !!s.name && (ts.getModifiers(s) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword))
      .map((s) => s.name!.text);
    const reexportadas = sf.statements.filter(ts.isExportDeclaration).flatMap((s) => (s.exportClause && ts.isNamedExports(s.exportClause) ? s.exportClause.elements.map((e) => e.name.text) : ["*"]));
    expect([...exportadas, ...reexportadas].filter((n) => GUARDAS_DE_SOLO_SESION.has(n) || n === "*")).toEqual([]);
    expect(exportadas.length, "con-sesion.ts tiene que seguir exportando las guardas con permiso").toBeGreaterThan(0);
  });

  it("el detector ve llamadas reales (con o sin await, anidadas) y no comentarios ni strings", () => {
    const fuente = [
      "// requerirSesion() en un comentario no cuenta",
      'const texto = "requerirSesionEnSucursal(x)";',
      "export async function a() { const ctx = await requerirSesion(); return ctx; }",
      "export const b = async (id: string) => { if (id) return requerirSesionEnSucursal(id); return null; };",
      "export async function c() { return requerirVer(\"precio_local\"); }",
    ].join("\n");
    expect(llamadasDeSoloSesion("f.ts", fuente)).toEqual(["f.ts|a", "f.ts|b"]);
  });
});
