import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Un `catch` de código de servidor que deja el error en `console.error` y sigue NO es ruidoso: los registros de Vercel del plan Hobby duran
 * 30 minutos y nadie los mira. Cada `catch` de `src/server`, `src/core` y `src/lib` que llama a `console.error` tiene que llamar también
 * a `reportarError` / `reportarErrorUnaVez` (Sentry). Falla cerrado: un `catch` nuevo con solo `console.error` rompe esta prueba.
 * (Los componentes y las pantallas de error del cliente quedan fuera: ahí el error ya lo captura el SDK de Sentry del navegador.)
 */
const RAIZ = join(__dirname, "../../src");
const CARPETAS = ["server", "core", "lib"];
const REPORTA = new Set(["reportarError", "reportarErrorUnaVez"]);

function archivos(dir: string, salida: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, e.name);
    if (e.isDirectory()) archivos(ruta, salida);
    else if (/\.(ts|tsx)$/.test(e.name)) salida.push(ruta);
  }
  return salida;
}

/** `archivo:línea` de cada `catch` con `console.error` y sin llamada a `reportarError*`. */
export function catchesMudos(rel: string, codigo: string): string[] {
  const fuente = ts.createSourceFile(rel, codigo, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const mudos: string[] = [];
  const visitar = (n: ts.Node) => {
    if (ts.isCatchClause(n)) {
      let consola = false;
      let reporta = false;
      const mirar = (h: ts.Node) => {
        if (ts.isCallExpression(h)) {
          const e = h.expression;
          if (ts.isPropertyAccessExpression(e) && e.expression.getText(fuente) === "console" && e.name.text === "error") consola = true;
          if (ts.isIdentifier(e) && REPORTA.has(e.text)) reporta = true;
        }
        ts.forEachChild(h, mirar);
      };
      mirar(n.block);
      if (consola && !reporta) mudos.push(`${rel}:${fuente.getLineAndCharacterOfPosition(n.getStart(fuente)).line + 1}`);
    }
    ts.forEachChild(n, visitar);
  };
  visitar(fuente);
  return mudos;
}

describe("los catch del servidor que registran un error también lo reportan", () => {
  it("el analizador distingue un catch ruidoso de uno mudo (sanidad: no pasa en vacío)", () => {
    expect(catchesMudos("x.ts", "async function f() { try { a(); } catch (e) { console.error(e); } }")).toEqual(["x.ts:1"]);
    expect(catchesMudos("x.ts", "async function f() { try { a(); } catch (e) { console.error(e); await reportarError(e, 'x'); } }")).toEqual([]);
    expect(catchesMudos("x.ts", "async function f() { try { a(); } catch (e) { await reportarErrorUnaVez('k', e, 'x'); console.error(e); } }")).toEqual([]);
    expect(catchesMudos("x.ts", "function f() { try { a(); } catch { return null; } }")).toEqual([]);
  });

  it("ningún catch de src/server, src/core ni src/lib deja un error solo en console.error", () => {
    const mudos = CARPETAS.flatMap((c) => archivos(join(RAIZ, c)))
      .map((a) => relative(RAIZ, a).replace(/\\/g, "/"))
      .flatMap((rel) => catchesMudos(rel, readFileSync(join(RAIZ, rel), "utf8")));
    expect(mudos, "un catch que solo hace console.error pasa desapercibido: llamá también a reportarError(e, \"<area>\") de @/lib/reportar-error").toEqual([]);
  });
});
