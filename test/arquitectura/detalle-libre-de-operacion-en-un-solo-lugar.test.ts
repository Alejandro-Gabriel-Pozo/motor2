import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Lote 2 de la deuda: el detalle libre que una persona escribe y llega a `Operacion.detalleLibre` se valida SOLO con `validarDetalleLibreDeOperacion` (`core/movimientos/anulaciones.ts`),
 * que además de largo rechaza el comienzo reservado de las reversiones por anulación. Un guard que valide «El detalle» con `validarTextoLibre` a secas reabre el hueco (un ajuste, un conteo
 * o una venta que se hace pasar por una reversión y que los reportes excluyen). La tabla de comandos con su caso está en `test/core/detalle-reservado-en-cada-comando.test.ts`.
 */
const RAIZ = join(__dirname, "../../src");

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const r = join(dir, n);
    return statSync(r).isDirectory() ? archivos(r) : /\.tsx?$/.test(r) ? [r] : [];
  });
}

/** Líneas (1-based) que validan «El detalle» con `validarTextoLibre` a secas. */
export function validacionesDeDetalleASecas(fuente: string): number[] {
  return fuente.split("\n").flatMap((l, i) => (/validarTextoLibre\([^)]*["'`]El detalle["'`]/.test(l) && !l.trim().startsWith("//") && !l.trim().startsWith("*") ? [i + 1] : []));
}

describe("el detalle libre de una operación se valida en un solo lugar", () => {
  it("ningún archivo de src valida «El detalle» con validarTextoLibre a secas (usan validarDetalleLibreDeOperacion)", () => {
    const malas = archivos(RAIZ).flatMap((ruta) => validacionesDeDetalleASecas(readFileSync(ruta, "utf8")).map((n) => `${relative(RAIZ, ruta).split(sep).join("/")}:${n}`));
    expect(malas, `Usá validarDetalleLibreDeOperacion (core/movimientos/anulaciones.ts) en vez de validarTextoLibre para el detalle de una operación:\n${malas.join("\n")}`).toEqual([]);
  });

  it("el detector marca la validación a secas y no la función compartida", () => {
    expect(validacionesDeDetalleASecas('const d = validarTextoLibre(x, "El detalle", LARGO_MAXIMO_DETALLE);')).toEqual([1]);
    expect(validacionesDeDetalleASecas("const d = validarDetalleLibreDeOperacion(x);")).toEqual([]);
    expect(validacionesDeDetalleASecas('// validarTextoLibre(x, "El detalle", 1)')).toEqual([]);
  });
});
