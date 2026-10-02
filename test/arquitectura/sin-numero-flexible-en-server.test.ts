import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * En `src/server/**` un número que llega de un POST crudo se valida con `esNumeroEstricto` (typeof "number" y finito), nunca con
 * `esNumeroFinito`, que convierte con `Number()` y deja pasar `null`, `""`, `[]` y `"5"`: lo validado y lo guardado dejan de ser lo mismo.
 * `esNumeroFinito` sigue existiendo para `src/core/**`, donde el dato ya pasó por un parser (`numeroDeEntrada`).
 */
const RAIZ = join(__dirname, "../../src/server");

function archivos(dir: string, salida: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, e.name);
    if (e.isDirectory()) archivos(ruta, salida);
    else if (/\.(ts|tsx)$/.test(e.name)) salida.push(ruta);
  }
  return salida;
}

function llamaA(codigo: string, nombre: string): boolean {
  const fuente = ts.createSourceFile("a.ts", codigo, ts.ScriptTarget.Latest, true);
  let hay = false;
  const visitar = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === nombre) hay = true;
    ts.forEachChild(n, visitar);
  };
  visitar(fuente);
  return hay;
}

describe("src/server no usa el chequeo numérico flexible", () => {
  it("el detector ve la llamada (sanidad: no pasa en vacío)", () => {
    expect(llamaA("if (!esNumeroFinito(x)) return;", "esNumeroFinito")).toBe(true);
    expect(llamaA("// esNumeroFinito(x)\nconst a = esNumeroEstricto(x);", "esNumeroFinito")).toBe(false);
  });

  it("ningún archivo de src/server llama a esNumeroFinito()", () => {
    const usan = archivos(RAIZ)
      .filter((a) => llamaA(readFileSync(a, "utf8"), "esNumeroFinito"))
      .map((a) => relative(RAIZ, a).replaceAll("\\", "/"));
    expect(usan, "usá esNumeroEstricto (core/numero.ts) para datos de un POST crudo").toEqual([]);
  });
});
