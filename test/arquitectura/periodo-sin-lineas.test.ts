import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * "Líneas" es un conteo de renglones de MovimientoStock, no de productos ni de compras — confundía al usuario (docs/planes-demo-
 * y-claridad-reportes-2026-09-21.md §2, "Líneas" es un conteo de renglones..."). Se reemplazó por "Productos"/"Compras" en la
 * tabla de compras por proveedor, y por "movimiento(s)" en los mensajes de anulación.
 *
 * Acotado a lo que tocó §2 (Período y márgenes + el mismo tratamiento en /reportes) — NO a todo `src/app/`: `/reportes/compras`
 * (la lista de compras registradas) todavía dice "N línea(s)" a propósito, ese arreglo es de §4 (Historial por producto y
 * "líneas" en Compras registradas), que usa un criterio de conteo distinto (productos, no renglones) y no se tocó en este paso.
 */
const ARCHIVOS = [
  join(__dirname, "../../src/app/(app)/reportes/periodo"),
  join(__dirname, "../../src/app/(app)/reportes/page.tsx"),
];

/** `\b`: evita falsos positivos como "alinear" (que contiene la subcadena "linea" pero no es la palabra "línea"). */
const PALABRA_LINEA = /\bl[ií]nea(s)?\b/i;

/** Saca comentarios de línea y de bloque (incluidos los `{/* JSX *\/}`) antes de buscar: son texto para quien lee el código, no texto visible en la pantalla. */
function sinComentarios(fuente: string): string {
  return fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function tsx(ruta: string): string[] {
  if (statSync(ruta).isFile()) return ruta.endsWith(".tsx") || ruta.endsWith(".ts") ? [ruta] : [];
  return readdirSync(ruta).flatMap((nombre) => tsx(join(ruta, nombre)));
}

describe("reportes/periodo y reportes (resumen): sin 'línea(s)' como texto visible", () => {
  it("la expresión distingue la palabra 'línea(s)' de 'alinear'", () => {
    expect(PALABRA_LINEA.test("alinear: 'derecha'")).toBe(false);
    expect(PALABRA_LINEA.test("N línea(s) de stock")).toBe(true);
    expect(PALABRA_LINEA.test("2 líneas")).toBe(true);
    expect(PALABRA_LINEA.test("Línea")).toBe(true);
  });

  it("ningún archivo de la ruta /reportes/periodo ni de /reportes usa 'línea(s)' fuera de un comentario", () => {
    const raiz = join(__dirname, "../../src");
    const malos = ARCHIVOS.flatMap((base) =>
      tsx(base).flatMap((ruta) => {
        const fuente = sinComentarios(readFileSync(ruta, "utf8").replace(/\r\n/g, "\n"));
        return PALABRA_LINEA.test(fuente) ? [relative(raiz, ruta).replaceAll("\\", "/")] : [];
      })
    );
    expect(malos, "\"línea(s)\" es un renglón de MovimientoStock, no un producto ni una compra — usar \"producto(s)\"/\"compra(s)\" o \"movimiento(s)\"").toEqual([]);
  });
});
