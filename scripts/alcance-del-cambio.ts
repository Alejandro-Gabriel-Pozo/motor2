/**
 * El filtro de alcance del CI (job `alcance` de `.github/workflows/ci.yml`; dueño, 2026-11-17: «Priorizá los PR de CI que ahorran cola», «si»): dado el listado de rutas que cambia un
 * pull request, dice si es «solo-docs» (el CI corre Estático e Integración y SALTA Build y E2E) o «completo» (corre todo).
 *
 * TODO NACE CERRADO: «solo-docs» es la ÚNICA respuesta que ahorra algo y exige que CADA ruta lo justifique (lista de permitidos: un `.md` de `docs/` o de la raíz). Cualquier otra cosa, una ruta rara
 * (vacía, absoluta, con `..`, con barra invertida), un listado vacío o un error al leerlo, da «completo». Es PURO y no importa nada: el job lo corre con `node` sin instalar dependencias.
 * El oráculo con sus casos está en `test/arquitectura/ci-alcance-del-cambio.test.ts`.
 *
 * Uso en el CI: `git diff --no-renames --name-only -z HEAD^1 HEAD | node scripts/alcance-del-cambio.ts` (con `--no-renames` un archivo movido de `src/` a `docs/` lista las dos rutas y da «completo»).
 */
export type Alcance = "solo-docs" | "completo";

/** Una parte de ruta permitida: empieza con letra, número o `_` (así `.`, `..` y los ocultos quedan afuera) y sigue con letras, números, espacio y `_ . @ + ( ) -`. Lista de permitidos: lo que no entra acá no justifica saltar nada. */
const PARTE = "[\\p{L}\\p{N}_][\\p{L}\\p{N}_ .@+()-]*";
const RUTA_BIEN_FORMADA = new RegExp(`^(?:${PARTE}/)*${PARTE}$`, "u");

/**
 * Una ruta sola justifica saltar Build y E2E si está bien formada y es un `.md` (en minúscula: `.MD` o `.markdown` no cuentan) de `docs/` (a cualquier profundidad) o de la RAÍZ del repositorio
 * (README.md, CLAUDE.md, AGENTS.md). Un `.md` dentro de `src/`, `prisma/`, `test/` o cualquier otra carpeta, y un archivo que no sea `.md` dentro de `docs/` (imágenes, json), NO lo justifican (dueño/orquestador, 2026-11-17).
 */
function esSoloDocs(ruta: string): boolean {
  if (!RUTA_BIEN_FORMADA.test(ruta) || !ruta.endsWith(".md")) return false;
  return ruta.startsWith("docs/") || !ruta.includes("/");
}

/** «solo-docs» únicamente si hay al menos una ruta y todas son de documentación; en cualquier otro caso, «completo». */
export function alcanceDelCambio(rutas: readonly string[]): Alcance {
  return rutas.length > 0 && rutas.every(esSoloDocs) ? "solo-docs" : "completo";
}

/** Las rutas de la salida de `git diff -z` (separadas por NUL). El último separador no deja una ruta vacía; una ruta vacía de verdad (dos NUL seguidos) se conserva y da «completo». */
export function rutasDeGitConNul(texto: string): string[] {
  const partes = texto.split("\0");
  if (partes.length > 0 && partes[partes.length - 1] === "") partes.pop();
  return partes;
}

// Línea de comandos: lee las rutas de la entrada estándar y escribe la respuesta. Un error cualquiera da «completo» (falla cerrado).
if (process.argv[1]?.endsWith("alcance-del-cambio.ts")) {
  const trozos: Buffer[] = [];
  process.stdin.on("data", (t: Buffer) => trozos.push(t));
  process.stdin.on("error", () => console.log("completo"));
  process.stdin.on("end", () => {
    try {
      console.log(alcanceDelCambio(rutasDeGitConNul(Buffer.concat(trozos).toString("utf8"))));
    } catch {
      console.log("completo");
    }
  });
}
