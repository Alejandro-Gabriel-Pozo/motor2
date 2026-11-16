import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regla de arquitectura («Ocultar» como Pedernal, docs/diseno-ocultar-como-pedernal-2026-11-15.md, I-12 y §8.4): «¿está este producto oculto en esta sucursal?» tiene UN solo lugar donde se escribe como filtro de
 * Prisma — `whereNoOcultoEn` en `core/catalogo/ocultar-producto-consulta.ts`, que arma `{ ocultamientos: { none: {...} } }` (el campo de relación `Producto.ocultamientos` de schema.prisma). Si otro archivo lo reimplementa a
 * mano puede divergir en silencio del criterio real (marca de la empresa O de la sucursal; sin marca = visible) sin que ningún tipo lo detecte. Igual que `disponibilidad-en-un-solo-lugar.test.ts`.
 *
 * Cómo se controla: ningún archivo de `src/`, salvo `ocultar-producto-consulta.ts`, puede contener la cadena `ocultamientos:` fuera de un comentario. (Leer o escribir la tabla `ocultamientoProducto` directo sigue
 * siendo trabajo de `persistencia/catalogo/ocultamiento.ts` y de `lecturas/catalogo/ocultamiento.ts`; lo único que tiene que vivir en un solo lugar es el FILTRO.)
 */
const RAIZ = join(__dirname, "../../src");
const ARCHIVO_PERMITIDO = "core/catalogo/ocultar-producto-consulta.ts";

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    return statSync(ruta).isDirectory() ? archivos(ruta) : /\.tsx?$/.test(nombre) ? [ruta] : [];
  });
}

const esComentario = (linea: string): boolean => /^\s*(\*|\/\/|\/\*)/.test(linea);

/** Las líneas (1-based) que escriben `ocultamientos:` fuera de un comentario. */
function lineasConOcultamientosAMano(fuente: string): number[] {
  const malas: number[] = [];
  fuente.replace(/\r\n/g, "\n").split("\n").forEach((linea, i) => {
    if (!esComentario(linea) && /ocultamientos:/.test(linea)) malas.push(i + 1);
  });
  return malas;
}

describe("Ocultar: un solo lugar escribe el filtro { ocultamientos: { none: ... } }", () => {
  const rutas = archivos(RAIZ);

  it("encuentra archivos de src/", () => {
    expect(rutas.length).toBeGreaterThan(50);
  });

  it("ningún archivo fuera de ocultar-producto-consulta.ts escribe `ocultamientos:` a mano", () => {
    const problemas: string[] = [];
    for (const ruta of rutas) {
      const nombre = relative(RAIZ, ruta).split(sep).join("/");
      if (nombre === ARCHIVO_PERMITIDO) continue;
      for (const linea of lineasConOcultamientosAMano(readFileSync(ruta, "utf8"))) problemas.push(`${nombre}:${linea}`);
    }
    expect(problemas, `Estas líneas escriben el filtro de ocultos a mano (usá whereNoOcultoEn):\n${problemas.join("\n")}`).toEqual([]);
  });

  it("el archivo permitido sí lo escribe (si no, el guardián pasaría en vacío)", () => {
    expect(lineasConOcultamientosAMano(readFileSync(join(RAIZ, ARCHIVO_PERMITIDO), "utf8"))).not.toEqual([]);
  });

  it("el detector: marca un where escrito a mano y deja pasar un comentario", () => {
    expect(lineasConOcultamientosAMano(["const where = {", "  ocultamientos: { none: { oculto: true } },", "};"].join("\n"))).toEqual([2]);
    expect(lineasConOcultamientosAMano(["// ocultamientos: { none: ... }", " * ocultamientos: x"].join("\n"))).toEqual([]);
  });
});
