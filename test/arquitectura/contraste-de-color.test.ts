import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Contraste de color (WCAG 1.4.3, AA: 4,5:1 para texto normal).
 *
 * `text-amber-600` (#d97706) sobre el fondo blanco de la app da 3,19:1: NO llega (axe lo marcó en /reportes/costos). Sobre el fondo oscuro da 6,2:1 y
 * sí llega; en cambio `amber-700` (#b45309) da 5,0:1 en claro pero 3,9:1 en oscuro. Por eso el texto ámbar va como `text-amber-700 dark:text-amber-600`:
 * cada par pasa en el modo donde se usa. Este test falla ante un `text-amber-600` a secas (sin `dark:` delante) o un `text-amber-700` sin su
 * variante oscura.
 *
 * Es estático: mira el texto de las clases, no el render (el render lo cubre `test/e2e/accesibilidad.spec.ts` con axe donde hay un caso sembrado).
 */
const RAIZ = join(__dirname, "../../src");

function tsx(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    return statSync(ruta).isDirectory() ? tsx(ruta) : ruta.endsWith(".tsx") ? [ruta] : [];
  });
}

/** Cada clase `text-amber-600` que no lleva `dark:` delante, y cada `text-amber-700` cuyo `className` no incluye `dark:text-amber-600`. */
function ambarSinPar(fuente: string): number[] {
  const lineas = fuente.replace(/\r\n/g, "\n").split("\n");
  const malas: number[] = [];
  lineas.forEach((linea, i) => {
    for (const m of linea.matchAll(/(?<![\w:-])text-amber-(600|700)(?![\w-])/g)) {
      const claseCompleta = linea.slice(linea.lastIndexOf('"', m.index) + 1, linea.indexOf('"', m.index));
      const tienePar = m[1] === "700" ? /(?<![\w-])dark:text-amber-600(?![\w-])/.test(claseCompleta) : false;
      if (!tienePar) malas.push(i + 1);
    }
  });
  return malas;
}

describe("color de texto ámbar: pasa AA en claro y en oscuro", () => {
  it("el detector distingue bien", () => {
    expect(ambarSinPar('<p className="text-amber-600">x</p>')).toEqual([1]);
    expect(ambarSinPar('<p className="text-sm text-amber-600">x</p>')).toEqual([1]);
    expect(ambarSinPar('<p className="text-amber-700">x</p>')).toEqual([1]);
    expect(ambarSinPar('<p className="text-amber-700 dark:text-amber-600">x</p>')).toEqual([]);
    expect(ambarSinPar('<p className="text-sm text-amber-700 dark:text-amber-600 underline">x</p>')).toEqual([]);
    expect(ambarSinPar('<p className="dark:text-amber-600">x</p>')).toEqual([]);
  });

  it("ningún archivo de src/ usa un ámbar de texto sin su par claro/oscuro", () => {
    const malos = tsx(RAIZ).flatMap((ruta) => ambarSinPar(readFileSync(ruta, "utf8")).map((n) => `${relative(RAIZ, ruta).replaceAll("\\", "/")}:${n}`));
    expect(malos, "usar `text-amber-700 dark:text-amber-600`").toEqual([]);
  });
});
