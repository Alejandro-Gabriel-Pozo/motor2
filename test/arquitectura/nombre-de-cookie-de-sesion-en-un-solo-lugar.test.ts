import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * El nombre de la cookie de sesión de Auth.js vive en UN solo archivo (`src/core/auth/cookie-sesion.ts`). Una lista copiada en otro lado se
 * desactualiza cuando cambia el nombre (pasó con `__Host-` en producción: el chequeo de «sesión abierta de otra cuenta» dejó de ver la cookie
 * y nada lo mostró, porque los tests corren por http). Todo el que necesite el nombre o el token importa de ahí.
 */
const RAIZ = join(__dirname, "../../src");
const DUENIO = "core/auth/cookie-sesion.ts";

function archivos(dir: string, salida: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, e.name);
    if (e.isDirectory()) archivos(ruta, salida);
    else if (/\.(ts|tsx)$/.test(e.name)) salida.push(ruta);
  }
  return salida;
}

/** Literales de texto del código (los comentarios no son literales, así que no cuentan). */
function literales(codigo: string): string[] {
  const fuente = ts.createSourceFile("archivo.ts", codigo, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const textos: string[] = [];
  const visitar = (nodo: ts.Node) => {
    if (ts.isStringLiteralLike(nodo)) textos.push(nodo.text);
    else if (ts.isTemplateHead(nodo) || ts.isTemplateMiddle(nodo) || ts.isTemplateTail(nodo)) textos.push(nodo.text);
    ts.forEachChild(nodo, visitar);
  };
  visitar(fuente);
  return textos;
}

describe("el nombre de la cookie de sesión está en un solo lugar", () => {
  it("el detector ve el literal (sanidad: no pasa en vacío)", () => {
    expect(literales(`const a = "authjs.session-token"; // authjs.session-token`)).toEqual(["authjs.session-token"]);
    expect(literales(readFileSync(join(RAIZ, DUENIO), "utf8")).some((t) => t.includes("authjs.session-token"))).toBe(true);
  });

  it("el texto `authjs.session-token` solo aparece como literal en core/auth/cookie-sesion.ts", () => {
    const fuera = archivos(RAIZ)
      .map((a) => relative(RAIZ, a).replace(/\\/g, "/"))
      .filter((rel) => rel !== DUENIO)
      .filter((rel) => literales(readFileSync(join(RAIZ, rel), "utf8")).some((t) => t.includes("authjs.session-token")));
    expect(fuera, `importá NOMBRES_COOKIE_SESION / nombreCookieSesion / tokenDeSesionAbierta de ${DUENIO}`).toEqual([]);
  });
});
