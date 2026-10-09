import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regla de arquitectura (O.1 de `docs/pureza-integracion.md`; Hito 4, bloque C, paso H4C-23): el reemplazo de la receta central «A CIEGAS» (sin versión esperada:
 * pisa en silencio un cambio ajeno) NO es alcanzable desde la red. Vive en `src/server/actions/catalogo/receta-a-ciegas.ts` (`guardarRecetaACiegas`), que:
 *  1. abre con `import "server-only"` y NO tiene `"use server"` (no es un endpoint: el navegador no la puede invocar);
 *  2. no la importa NINGÚN otro archivo de `src/` ni de la consola (`plataforma/`): ni una página, ni una Server Action, ni un caso de uso (si una acción la
 *     reexportara o la llamara, volvería a ser alcanzable por la red);
 *  3. solo la importan `scripts/` (los seeds de demo) y `test/`.
 * La acción pública `guardarReceta` exige la versión (`receta-publica-exige-version.test.ts`). Se mira el texto de cada archivo (import por alias o relativo, o el
 * nombre de la función), sin los comentarios.
 */
const RAIZ = join(__dirname, "../..");
const DESTINO_REL = "src/server/actions/catalogo/receta-a-ciegas.ts";
const IMPORTA = /["'](?:@\/server\/actions\/catalogo\/receta-a-ciegas|(?:\.{1,2}\/)+(?:[\w-]+\/)*receta-a-ciegas)["']|\bguardarRecetaACiegas\b/;

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    if (nombre === "node_modules" || nombre === ".next") return [];
    const ruta = join(dir, nombre);
    return statSync(ruta).isDirectory() ? archivos(ruta) : /\.(tsx?|mts|cts)$/.test(nombre) ? [ruta] : [];
  });
}

const sinComentarios = (fuente: string) => fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** Los archivos (relativos a la raíz) cuyo código importa o nombra la función a ciegas, salvo el propio módulo. */
function importadores(lista: { nombre: string; fuente: string }[]): string[] {
  return lista
    .filter((a) => a.nombre !== DESTINO_REL)
    .filter((a) => IMPORTA.test(sinComentarios(a.fuente)))
    .map((a) => a.nombre)
    .sort();
}

const leer = (dir: string) => archivos(join(RAIZ, dir)).map((ruta) => ({ nombre: relative(RAIZ, ruta).split(sep).join("/"), fuente: readFileSync(ruta, "utf8") }));

describe("guardarRecetaACiegas: solo desde scripts y tests", () => {
  it("el detector ve un import por alias, uno relativo y la función por su nombre; un comentario no cuenta", () => {
    const f = (fuente: string) => importadores([{ nombre: "src/app/x/page.tsx", fuente }]);
    expect(f('import { guardarRecetaACiegas } from "@/server/actions/catalogo/receta-a-ciegas";')).toEqual(["src/app/x/page.tsx"]);
    expect(f('import { x } from "../catalogo/receta-a-ciegas";')).toEqual(["src/app/x/page.tsx"]);
    expect(f('import { x } from "./receta-a-ciegas";')).toEqual(["src/app/x/page.tsx"]);
    expect(f("export { guardarRecetaACiegas as g } from './otro';")).toEqual(["src/app/x/page.tsx"]);
    expect(f('import { guardarReceta } from "@/server/actions/catalogo/recetas";')).toEqual([]);
    expect(f("// guardarRecetaACiegas está en receta-a-ciegas.ts\n/* \"./receta-a-ciegas\" */")).toEqual([]);
  });

  it("el módulo es server-only y NO es un endpoint (sin \"use server\")", () => {
    const fuente = readFileSync(join(RAIZ, DESTINO_REL), "utf8");
    expect(fuente.trimStart().startsWith('import "server-only";')).toBe(true);
    expect(/^\s*["']use server["']/m.test(sinComentarios(fuente))).toBe(false);
    expect(fuente).toMatch(/export async function guardarRecetaACiegas\(/);
  });

  it("ningún archivo de src/ ni de la consola la importa", () => {
    const todos = [...leer("src"), ...leer("plataforma/src")];
    expect(todos.length).toBeGreaterThan(300);
    expect(importadores(todos), "guardarRecetaACiegas no se importa desde la aplicación: la acción pública es guardarReceta, con la versión esperada").toEqual([]);
  });

  it("la importan los seeds de demo y los tests (la regla no quedó vacía)", () => {
    const fuera = [...leer("scripts"), ...leer("test")];
    const reales = importadores(fuera);
    expect(reales).toEqual(expect.arrayContaining(["scripts/seed-demo-pizzeria.ts", "scripts/seed-demo-pizzeria-6-meses.ts", "test/catalogo/recetas.test.ts"]));
    expect(reales.filter((n) => !/^(scripts|test)\//.test(n))).toEqual([]);
  });
});
