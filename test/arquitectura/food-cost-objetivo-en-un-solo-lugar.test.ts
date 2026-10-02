import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regla de arquitectura: el food cost objetivo (hoy 40 % del precio de venta, sin packaging) vive en UN solo lugar —
 * `FOOD_COST_OBJETIVO_PCT` (`core/reportes/margen-objetivo.ts`). El estado «Food cost alto», la columna «Precio para food cost» y los textos de
 * ayuda de los reportes salen de ahí. Un `0.4` o un «40%» escritos a mano en un reporte quedarían desfasados el día que el objetivo se
 * configure (por empresa o por categoría), y TypeScript no lo detecta: es un número como cualquier otro.
 *
 * Cómo se controla: en `src/core/reportes/` y `src/app/(app)/reportes/`, ningún archivo salvo `margen-objetivo.ts` puede escribir 0.4, .4, 0.40
 * ni 40% (ni «40 %») fuera de un comentario.
 */
const RAIZ = join(__dirname, "../../src");
const CARPETAS = ["core/reportes", "app/(app)/reportes"];
const DUENO = "core/reportes/margen-objetivo.ts";
const NUMERO_FIJO = /(?<![\w.])0?\.40?(?!\d)|(?<![\d.])40\s*%/;

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    return statSync(ruta).isDirectory() ? archivos(ruta) : /\.tsx?$/.test(nombre) ? [ruta] : [];
  });
}

function esComentario(linea: string): boolean {
  const t = linea.trim();
  return t.startsWith("*") || t.startsWith("//") || t.startsWith("/*");
}

/** Las líneas (1-based) que escriben el objetivo como número fijo fuera de un comentario (se ignora lo que va después de un `//` en la misma línea). */
function lineasConObjetivoFijo(fuente: string): number[] {
  const malas: number[] = [];
  fuente
    .replace(/\r\n/g, "\n")
    .split("\n")
    .forEach((linea, i) => {
      if (esComentario(linea)) return;
      if (NUMERO_FIJO.test(linea.replace(/\s\/\/.*$/, ""))) malas.push(i + 1);
    });
  return malas;
}

describe("food cost objetivo: un solo lugar tiene el número", () => {
  const rutas = CARPETAS.flatMap((c) => archivos(join(RAIZ, c)));

  it("encuentra los archivos de los reportes", () => {
    expect(rutas.length).toBeGreaterThan(30);
  });

  it("ningún reporte fuera de margen-objetivo.ts escribe 0.4 ni 40% a mano", () => {
    const problemas: string[] = [];
    for (const ruta of rutas) {
      const nombre = relative(RAIZ, ruta).split(sep).join("/");
      if (nombre === DUENO) continue;
      for (const linea of lineasConObjetivoFijo(readFileSync(ruta, "utf8"))) problemas.push(`${nombre}:${linea}`);
    }
    expect(
      problemas,
      `Estas líneas escriben el food cost objetivo a mano (usá FOOD_COST_OBJETIVO_PCT / superaFoodCostObjetivo de core/reportes/margen-objetivo.ts):\n${problemas.join("\n")}`
    ).toEqual([]);
  });

  it("el archivo dueño existe y define la constante (la regla no quedó apuntando a la nada)", () => {
    const fuente = readFileSync(join(RAIZ, DUENO), "utf8");
    expect(fuente).toMatch(/export const FOOD_COST_OBJETIVO_PCT = \d+;/);
  });

  describe("el detector (con fuentes sintéticas)", () => {
    it("marca 0.4, .4, 0.40 y 40% con o sin espacio", () => {
      const fuente = ["if (x > 0.4) a();", "if (x > .4) a();", "if (x > 0.40) a();", 'const t = "supera el 40% del precio";', 'const t = "supera el 40 % del precio";'].join("\n");
      expect(lineasConObjetivoFijo(fuente)).toEqual([1, 2, 3, 4, 5]);
    });

    it("no marca otros números ni un comentario", () => {
      const fuente = ["const a = 0.45;", "const b = 140%;", "const c = 10.4;", "const d = 0.04;", "// 40% fijo, antes 0.4", " * umbral 40%", "const e = 1; // el 40% de antes"].join("\n");
      expect(lineasConObjetivoFijo(fuente)).toEqual([]);
    });
  });
});
