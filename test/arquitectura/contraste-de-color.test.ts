import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Contraste de color (WCAG 1.4.3, AA: 4,5:1 para texto normal).
 *
 * La aplicación no tiene modo oscuro (DEC-04, Fase 6): la variante `dark:` está retirada (ver `sin-modo-oscuro.test.ts`), así que todo texto se
 * evalúa solo sobre el fondo blanco.
 *
 * `text-amber-600` (#d97706) sobre blanco da 3,19:1: NO llega (axe lo marcó en /reportes/costos). `text-amber-700` (#b45309) da 5,0:1 y sí llega.
 * Este test falla ante un `text-amber-600` sin `dark:` delante. Un `dark:text-amber-600` que quede de antes no es hallazgo: con la variante retirada
 * no se activa (se va con el retiro por lotes de las clases `dark:`).
 *
 * Lo mismo con `text-neutral-400` (#a3a3a3): 2,5:1 sobre blanco. Va como `text-neutral-500` (4,7:1); un `dark:text-neutral-400` que quede de antes
 * tampoco se activa.
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

/** Cada clase `text-amber-600` que no lleva `dark:` delante (3,19:1 sobre blanco; la forma correcta es `text-amber-700`). */
function ambarFlojo(fuente: string): number[] {
  const malas: number[] = [];
  fuente.replace(/\r\n/g, "\n").split("\n").forEach((linea, i) => {
    malas.push(...Array.from(linea.matchAll(/(?<![\w:-])text-amber-600(?![\w-])/g), () => i + 1));
  });
  return malas;
}

/** Cada `text-neutral-400` que no lleva `dark:` delante (la forma correcta es `text-neutral-500`). */
function neutro400SinPar(fuente: string): number[] {
  const malas: number[] = [];
  fuente.replace(/\r\n/g, "\n").split("\n").forEach((linea, i) => {
    if (/(?<![\w:-])text-neutral-400(?![\w-])/.test(linea)) malas.push(i + 1);
  });
  return malas;
}

describe("texto gris claro: pasa AA sobre blanco", () => {
  it("el detector distingue bien", () => {
    expect(neutro400SinPar('<p className="text-neutral-400">x</p>')).toEqual([1]);
    expect(neutro400SinPar('<p className="text-xs text-neutral-400">x</p>')).toEqual([1]);
    expect(neutro400SinPar('<p className="text-neutral-500">x</p>')).toEqual([]);
    expect(neutro400SinPar('<p className="text-neutral-500 dark:text-neutral-400">x</p>')).toEqual([]);
  });

  it("ningún archivo de src/ usa text-neutral-400 sin dark:", () => {
    const malos = tsx(RAIZ).flatMap((ruta) => neutro400SinPar(readFileSync(ruta, "utf8")).map((n) => `${relative(RAIZ, ruta).replaceAll("\\", "/")}:${n}`));
    expect(malos, "usar `text-neutral-500` (4,7:1 sobre blanco)").toEqual([]);
  });
});

describe("color de texto ámbar: pasa AA sobre blanco", () => {
  it("el detector distingue bien", () => {
    expect(ambarFlojo('<p className="text-amber-600">x</p>')).toEqual([1]);
    expect(ambarFlojo('<p className="text-sm text-amber-600">x</p>')).toEqual([1]);
    expect(ambarFlojo('<p className="text-amber-700">x</p>')).toEqual([]);
    expect(ambarFlojo('<p className="text-amber-700 dark:text-amber-600">x</p>')).toEqual([]);
    expect(ambarFlojo('<p className="dark:text-amber-600">x</p>')).toEqual([]);
  });

  it("ningún archivo de src/ usa text-amber-600 sin dark:", () => {
    const malos = tsx(RAIZ).flatMap((ruta) => ambarFlojo(readFileSync(ruta, "utf8")).map((n) => `${relative(RAIZ, ruta).replaceAll("\\", "/")}:${n}`));
    expect(malos, "usar `text-amber-700` (5,0:1 sobre blanco)").toEqual([]);
  });
});
