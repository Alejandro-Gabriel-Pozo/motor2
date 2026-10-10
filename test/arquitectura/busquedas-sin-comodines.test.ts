import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Toda búsqueda `contains` de Prisma (LIKE/ILIKE) escapa el texto con `escaparComodinesLike`: `%`, `_` y `\` son comodines/escape de LIKE y Prisma no los escapa, así que sin esto
 * buscar `%` devolvía todo y `pan_i` encontraba «Pan integral» (ver `test/seguridad/inyeccion-sql-y-xss.test.ts`). Falla cerrado: una búsqueda nueva que pase el texto crudo rompe esta prueba.
 */
const RAIZ = join(__dirname, "../..");

function archivos(dir: string, salida: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".next") continue;
    const ruta = join(dir, e.name);
    if (e.isDirectory()) archivos(ruta, salida);
    else if (/\.(ts|tsx)$/.test(e.name)) salida.push(ruta);
  }
  return salida;
}

/** `archivo:línea` de cada `contains: <algo>` (filtro de Prisma) cuyo valor no pasa por `escaparComodinesLike`. */
export function busquedasSinEscapar(rel: string, codigo: string): string[] {
  const malas: string[] = [];
  codigo.split("\n").forEach((linea, i) => {
    for (const m of linea.matchAll(/\bcontains:\s*([^,}]+)/g)) {
      if (!m[1].trim().startsWith("escaparComodinesLike(")) malas.push(`${rel}:${i + 1}`);
    }
  });
  return malas;
}

describe("las búsquedas con `contains` escapan los comodines de LIKE", () => {
  it("el detector reconoce lo crudo y lo escapado", () => {
    expect(busquedasSinEscapar("a.ts", "where: { nombre: { contains: q, mode: 'insensitive' } }")).toEqual(["a.ts:1"]);
    expect(busquedasSinEscapar("a.ts", "where: { nombre: { contains: escaparComodinesLike(q), mode: 'insensitive' } }")).toEqual([]);
    expect(busquedasSinEscapar("a.ts", "x: { contains: t }, y: { contains: escaparComodinesLike(t) }")).toEqual(["a.ts:1"]);
  });

  it("ninguna búsqueda de src/ ni de plataforma/ pasa el texto crudo", () => {
    const malas = ["src", "plataforma"].flatMap((carpeta) =>
      archivos(join(RAIZ, carpeta)).flatMap((ruta) => busquedasSinEscapar(relative(RAIZ, ruta), readFileSync(ruta, "utf8")))
    );
    expect(malas, "usá contains: escaparComodinesLike(texto) (src/core/texto.ts)").toEqual([]);
  });
});
