import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * `core` sin estado de módulo (O.33, paso L.2 del Hito 3 de `pureza-integracion`).
 *
 * El limitador de mutaciones vivía en `core/permisos/limitador-tasa.ts` como una INSTANCIA de módulo (un `Map` de ventanas por usuario que crece con cada pedido):
 * estado del proceso dentro del núcleo, que tiene que ser lógica pura. Se mudó a `server/actions/limitador-de-mutaciones.ts`; en `core` queda la fábrica. Dos reglas:
 *  1. Ningún archivo de `src/core` declara `let` o `var` a nivel de módulo (una variable que se reasigna entre pedidos es estado del proceso). Excepciones con motivo,
 *     revisadas en las dos direcciones (la excepción tiene que seguir declarándola).
 *  2. `crearLimitadorDeTasa` (la fábrica, pura) se INSTANCIA solo fuera de `core`: si `core` la llamara, volvería a tener una instancia con estado.
 *
 * Qué no cubre: un `const` de módulo con un objeto mutable (un `Map` de caché, el enviador de correo en memoria). La regla de hoy ataja la forma del limitador;
 * ampliarla a colecciones mutables es otra decisión (hay cachés legítimas de valores derivados, como los formateadores de `core/tiempo`).
 */
const SRC = join(__dirname, "../../src");
const CORE = join(SRC, "core");

/** `ruta relativa a src/` → nombres de las variables `let`/`var` de módulo que se aceptan, y por qué. */
const ESTADO_DE_MODULO_ACEPTADO: Record<string, { variables: string[]; motivo: string }> = {
  "core/auth/base.ts": {
    variables: ["datosDelRolDelProceso"],
    motivo:
      "Memoriza (una vez por proceso) la lectura del rol de ejecución de la base para `verificarRolDeEjecucionDelProceso` (ADR-022). `core/auth/base.ts` es un heredado que sale de `core` en la Fase 6 (sesión y base), y se lleva esta variable.",
  },
};

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const ruta = join(dir, n);
    return statSync(ruta).isDirectory() ? archivos(ruta) : /\.tsx?$/.test(n) ? [ruta] : [];
  });
}

/** Los nombres de las variables `let`/`var` declaradas a nivel de módulo (no las de adentro de una función o un bloque). */
function variablesDeModulo(fuente: string): string[] {
  const sf = ts.createSourceFile("x.ts", fuente, ts.ScriptTarget.Latest, true);
  const nombres: string[] = [];
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt) || stmt.declarationList.flags & ts.NodeFlags.Const) continue;
    for (const d of stmt.declarationList.declarations) nombres.push(d.name.getText(sf));
  }
  return nombres;
}

/** Cuántas llamadas a `crearLimitadorDeTasa(…)` tiene el fuente (AST: los comentarios no cuentan). */
function instanciasDelLimitador(fuente: string): number {
  const sf = ts.createSourceFile("x.ts", fuente, ts.ScriptTarget.Latest, true);
  let n = 0;
  const visitar = (nodo: ts.Node): void => {
    if (ts.isCallExpression(nodo) && ts.isIdentifier(nodo.expression) && nodo.expression.text === "crearLimitadorDeTasa") n++;
    ts.forEachChild(nodo, visitar);
  };
  visitar(sf);
  return n;
}

const nombreDe = (ruta: string) => relative(SRC, ruta).split(sep).join("/");

describe("core sin estado de módulo", () => {
  const delCore = archivos(CORE).map((r) => ({ ruta: nombreDe(r), fuente: readFileSync(r, "utf8") }));

  it("encuentra los archivos de core (si no, la regla no mira nada)", () => {
    expect(delCore.length).toBeGreaterThan(100);
  });

  it("ningún archivo de core declara let/var de módulo (salvo las excepciones con motivo, que siguen declarándolas)", () => {
    const encontradas = Object.fromEntries(delCore.map((a) => [a.ruta, variablesDeModulo(a.fuente)] as const).filter(([, vs]) => vs.length > 0));
    const aceptadas = Object.fromEntries(Object.entries(ESTADO_DE_MODULO_ACEPTADO).map(([ruta, e]) => [ruta, e.variables]));
    expect(encontradas, "Estado de módulo en core: llevalo a la capa del servidor que lo usa (o, si es inevitable, declaralo arriba con su motivo).").toEqual(aceptadas);
  });

  it("crearLimitadorDeTasa se instancia solo fuera de core (la instancia de las mutaciones vive en server/actions)", () => {
    expect(delCore.filter((a) => instanciasDelLimitador(a.fuente) > 0).map((a) => a.ruta)).toEqual([]);
    const fuera = archivos(SRC)
      .filter((r) => !nombreDe(r).startsWith("core/"))
      .filter((r) => instanciasDelLimitador(readFileSync(r, "utf8")) > 0)
      .map(nombreDe);
    expect(fuera).toEqual(["server/actions/limitador-de-mutaciones.ts"]);
  });

  it("el detector (con fuentes sintéticas)", () => {
    expect(variablesDeModulo("let a = 1; var b; const c = 2; export let d: number | undefined;")).toEqual(["a", "b", "d"]);
    expect(variablesDeModulo("export function f() { let x = 1; return x; }\nconst g = () => { var y = 2; return y; };")).toEqual([]);
    expect(instanciasDelLimitador("export const l = crearLimitadorDeTasa(3, 60_000);\n// crearLimitadorDeTasa(1, 1)")).toBe(1);
    expect(instanciasDelLimitador('import { crearLimitadorDeTasa } from "x";')).toBe(0);
  });
});
