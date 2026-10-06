import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";

/** `src/` del repositorio. */
const SRC = join(__dirname, "../../../src");

export interface CasoDeUsoReal {
  /** Ruta relativa a `src/`, con `/`, ej. `server/actions/stock/casos-de-uso/reclasificar-stock.ts`. */
  ruta: string;
  fuente: string;
  /** Ruta ABSOLUTA del archivo del caso de uso. */
  absoluta: string;
  /** Los archivos de la Server Action (un nivel arriba de `casos-de-uso/`) que lo importan, con su fuente. */
  envolventes: { archivo: string; fuente: string }[];
}

function archivosFuente(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    return statSync(ruta).isDirectory() ? archivosFuente(ruta) : /\.tsx?$/.test(nombre) ? [ruta] : [];
  });
}

/**
 * Descubre TODO archivo bajo `server/actions/<dominio>/casos-de-uso/<archivo>.ts` cuya Server Action (un archivo UN nivel arriba) lo importa:
 * un caso de uso REAL, no un helper interno (`armar-linea-de-movimiento.ts`, `producto-transferible.ts`: solo los importan archivos hermanos
 * dentro de `casos-de-uso/`, nunca la Server Action). Un caso de uso nuevo se descubre solo: no hay una lista a mano que alguien olvide.
 */
export function descubrirCasosDeUsoReales(): CasoDeUsoReal[] {
  const archivos = archivosFuente(SRC).filter((r) => /[\\/]server[\\/]actions[\\/][^\\/]+[\\/]casos-de-uso[\\/][^\\/]+\.tsx?$/.test(r));
  const resultado: CasoDeUsoReal[] = [];

  for (const archivo of archivos) {
    const basename = archivo.replace(/\.tsx?$/, "").split(/[\\/]/).pop()!;
    const carpetaAccion = dirname(dirname(archivo));
    const envolventes = readdirSync(carpetaAccion)
      .filter((nombre) => /\.tsx?$/.test(nombre) && statSync(join(carpetaAccion, nombre)).isFile())
      .map((nombre) => ({ archivo: nombre, fuente: readFileSync(join(carpetaAccion, nombre), "utf8") }))
      .filter((h) => new RegExp(`from\\s+["']\\./casos-de-uso/${basename}["']`).test(h.fuente));
    if (envolventes.length === 0) continue;
    resultado.push({ ruta: relative(SRC, archivo).split(sep).join("/"), fuente: readFileSync(archivo, "utf8"), absoluta: archivo, envolventes });
  }
  return resultado;
}
