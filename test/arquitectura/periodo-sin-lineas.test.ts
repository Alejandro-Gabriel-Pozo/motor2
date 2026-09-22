import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * "Líneas" es un conteo de renglones de MovimientoStock, no de productos ni de compras — confundía al usuario (docs/planes-demo-
 * y-claridad-reportes-2026-09-21.md §2, "Líneas" es un conteo de renglones..."). Se reemplazó por "Productos"/"Compras" en la
 * tabla de compras por proveedor (§2, /reportes/periodo), por "movimiento(s)" en los mensajes de anulación, y por "producto(s)"
 * en /reportes/compras (§4, paso 6 del plan — docs/plan-historial-producto-mp-pv-2026-09-22.md): mismo criterio de conteo que §2
 * (productos DISTINTOS, no renglones), mismo vocabulario, coordinado a propósito para no tener dos palabras en dos pantallas.
 *
 * Acotado a lo que tocaron §2 y §4 — NO a todo `src/app/`: cualquier pantalla nueva que use "líneas" (renglones de Kardex u
 * otra cosa) con un sentido genuinamente distinto queda afuera de este chequeo hasta que alguien decida qué palabra usar ahí.
 */
const ARCHIVOS = [
  join(__dirname, "../../src/app/(app)/reportes/periodo"),
  join(__dirname, "../../src/app/(app)/reportes/page.tsx"),
  join(__dirname, "../../src/app/(app)/reportes/compras"),
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

describe("reportes/periodo, reportes (resumen) y reportes/compras: sin 'línea(s)' como texto visible", () => {
  it("la expresión distingue la palabra 'línea(s)' de 'alinear'", () => {
    expect(PALABRA_LINEA.test("alinear: 'derecha'")).toBe(false);
    expect(PALABRA_LINEA.test("N línea(s) de stock")).toBe(true);
    expect(PALABRA_LINEA.test("2 líneas")).toBe(true);
    expect(PALABRA_LINEA.test("Línea")).toBe(true);
  });

  it("ningún archivo de /reportes/periodo, /reportes o /reportes/compras usa 'línea(s)' fuera de un comentario", () => {
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
