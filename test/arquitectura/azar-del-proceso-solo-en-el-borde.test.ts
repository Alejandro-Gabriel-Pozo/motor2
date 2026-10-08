import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * El azar del proceso (`azarDelProceso`, el adaptador `src/lib/azar.ts`) lo toma el BORDE y lo pasa por parámetro (Pureza 1.5): la Server Action se lo da a su caso
 * de uso (`agregarOActualizarUsuarioCasoDeUso(ctx, comando, azarDelProceso)`, `darDeAltaProductoCasoDeUso(ctx, datos, azarDelProceso)`), y el núcleo lo recibe en
 * `Transaccion.aleatorio` desde `core/auth/base.ts`. Un caso de uso, la persistencia, una lectura o una consulta que lo importan por su cuenta esconden el azar: un
 * test ya no puede fijarlo (precedente: la huella de la alta de admin con azar fijo, 1.2).
 *
 * Nació en el Hito 4, bloque 4.3, paso H4C-12, de la mutación «el caso de uso del alta de un producto usa `azarDelProceso` en vez del que recibe», que ningún test
 * veía: la ficha solo mira el reloj, y `reloj-y-azar-en-el-servidor.test.ts` mira las LECTURAS directas del azar (`randomUUID`, `Math.random`), no el adaptador.
 *
 * Cómo se controla: los `import` (y `export … from`) de cada archivo de esas capas, por AST; un especificador que resuelve a `src/lib/azar` (con alias o relativo).
 */
const RAIZ = join(__dirname, "..", "..");
const CARPETAS = ["src/server/persistencia", "src/server/lecturas", "src/server/consultas"];
const RE_CASOS_DE_USO = /^src\/server\/actions\/[^/]+\/casos-de-uso\//;

function archivos(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const ruta = join(dir, e.name);
    return e.isDirectory() ? archivos(ruta) : /\.tsx?$/.test(e.name) ? [ruta] : [];
  });
}

/** `true` si algún import o reexport del código apunta al adaptador del azar (`@/lib/azar`, o una ruta relativa que termina en `lib/azar`). */
function importaElAzarDelProceso(codigo: string): boolean {
  const fuente = ts.createSourceFile("x.ts", codigo, ts.ScriptTarget.Latest, true);
  return fuente.statements.some((s) => {
    const especificador = (ts.isImportDeclaration(s) || ts.isExportDeclaration(s)) && s.moduleSpecifier && ts.isStringLiteral(s.moduleSpecifier) ? s.moduleSpecifier.text : null;
    return especificador !== null && /(^@\/|\/)lib\/azar(\.ts)?$/.test(especificador);
  });
}

describe("el azar del proceso solo lo toma el borde", () => {
  it("el detector ve el import del adaptador (con alias o relativo) y no confunde el puerto", () => {
    expect(importaElAzarDelProceso('import { azarDelProceso } from "@/lib/azar";')).toBe(true);
    expect(importaElAzarDelProceso('import { azarDelProceso } from "../../../lib/azar";')).toBe(true);
    expect(importaElAzarDelProceso('export { azarDelProceso } from "@/lib/azar";')).toBe(true);
    expect(importaElAzarDelProceso('import type { FuenteDeAzar } from "@/core/seguridad/azar";')).toBe(false);
  });

  it("ningún caso de uso, persistencia, lectura ni consulta importa src/lib/azar", () => {
    const todos = [
      ...archivos(join(RAIZ, "src/server/actions")).map((a) => relative(RAIZ, a).split(sep).join("/")).filter((r) => RE_CASOS_DE_USO.test(r)),
      ...CARPETAS.flatMap((c) => archivos(join(RAIZ, c))).map((a) => relative(RAIZ, a).split(sep).join("/")),
    ];
    expect(todos.filter((r) => RE_CASOS_DE_USO.test(r)).length, "sanidad: ve los casos de uso").toBeGreaterThan(50);
    const infractores = todos.filter((r) => importaElAzarDelProceso(readFileSync(join(RAIZ, r), "utf8")));
    expect(infractores, "El azar entra por parámetro: que la Server Action pase `azarDelProceso` al caso de uso (Pureza 1.5).").toEqual([]);
  });
});
