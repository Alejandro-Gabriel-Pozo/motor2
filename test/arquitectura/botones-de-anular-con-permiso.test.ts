import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Un botón «Anular…» que se muestra a quien solo puede VER la pantalla invita a una acción que el servidor va a rechazar (y deja
 * creer que el permiso existe). Toda pantalla/componente de `src/app` y `src/components` que importe un `BotonAnular*` tiene que consultar
 * el permiso (`obtenerMiNivelPermiso`) para decidir si lo pinta. El servidor sigue exigiendo el permiso de todos modos (`conPermiso`).
 */
const RAIZ = join(__dirname, "../../src");

function archivos(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const ruta = join(dir, e.name);
    return e.isDirectory() ? archivos(ruta) : /\.tsx$/.test(e.name) ? [ruta] : [];
  });
}

/** Si el fuente importa un `BotonAnular*` y si llama a `obtenerMiNivelPermiso`. */
export function analizarBotonesDeAnular(codigo: string): { importaBoton: boolean; consultaPermiso: boolean } {
  const fuente = ts.createSourceFile("x.tsx", codigo, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let importaBoton = false;
  let consultaPermiso = false;
  const visitar = (n: ts.Node): void => {
    if (ts.isImportSpecifier(n) && n.name.text.startsWith("BotonAnular")) importaBoton = true;
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "obtenerMiNivelPermiso") consultaPermiso = true;
    ts.forEachChild(n, visitar);
  };
  visitar(fuente);
  return { importaBoton, consultaPermiso };
}

describe("los botones «Anular…» se pintan solo con el permiso", () => {
  it("el analizador distingue los casos (sanidad: no pasa en vacío)", () => {
    expect(analizarBotonesDeAnular(`import { BotonAnularVenta } from "./b"; export default function P() { return <BotonAnularVenta />; }`)).toEqual({ importaBoton: true, consultaPermiso: false });
    expect(analizarBotonesDeAnular(`import { BotonAnularVenta } from "./b"; const n = await obtenerMiNivelPermiso(a, b, "x", d);`)).toEqual({ importaBoton: true, consultaPermiso: true });
    expect(analizarBotonesDeAnular(`import { Otro } from "./b";`)).toEqual({ importaBoton: false, consultaPermiso: false });
  });

  it("toda pantalla que importa un BotonAnular* consulta obtenerMiNivelPermiso", () => {
    const todos = ["app", "components"].flatMap((c) => archivos(join(RAIZ, c)));
    const conBoton: string[] = [];
    const sinPermiso: string[] = [];
    for (const ruta of todos) {
      const { importaBoton, consultaPermiso } = analizarBotonesDeAnular(readFileSync(ruta, "utf8"));
      const rel = relative(RAIZ, ruta).split(sep).join("/");
      if (importaBoton) conBoton.push(rel);
      if (importaBoton && !consultaPermiso) sinPermiso.push(rel);
    }
    expect(conBoton.length, "no se encontró ninguna pantalla con un BotonAnular*: ¿cambió el nombre?").toBeGreaterThanOrEqual(2);
    expect(sinPermiso, "pinta un BotonAnular* sin mirar el permiso: usá obtenerMiNivelPermiso(...).editar para decidir si mostrarlo").toEqual([]);
  });
});
