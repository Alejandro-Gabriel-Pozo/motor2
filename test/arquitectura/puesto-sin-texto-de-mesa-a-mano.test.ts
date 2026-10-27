import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guardián G1 del mostrador (ADR-039, etapa M1.1): el nombre del puesto en los textos («Mesa 7» / «Mostrador», «de la mesa 7» / «del mostrador») sale de
 * UN solo lugar, `src/core/pos/puesto.ts` (`frasesDePuesto`, `rotuloDePuesto`). Un caso de uso que arme «Mesa ${numero}» a mano diría «Mesa 0» al operar
 * el mostrador (el mostrador es la `Mesa` de número 0), y TypeScript no lo detecta (es un texto).
 *
 * Qué se controla: ninguna línea de código (fuera de un comentario) de los casos de uso y acciones del POS, la persistencia del POS, las consultas del POS y las
 * pantallas del POS contiene «Mesa ${…}» ni «mesa ${…}» (ni «Mesa {…}» en JSX), salvo `puesto.ts`, que no está en estas carpetas.
 */
const RAIZ = join(__dirname, "../../src");
const CARPETAS = ["server/actions/pos", "server/persistencia/pos", "server/consultas/pos", "app/(pos)"];
const TEXTO_DE_MESA_A_MANO = /\b[Mm]esa (\$\{|\{)/;

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

/** Las líneas (1-based) que arman «Mesa ${…}» a mano fuera de un comentario. */
function lineasConTextoDeMesaAMano(fuente: string): number[] {
  const malas: number[] = [];
  fuente
    .replace(/\r\n/g, "\n")
    .split("\n")
    .forEach((linea, i) => {
      if (esComentario(linea)) return;
      if (TEXTO_DE_MESA_A_MANO.test(linea)) malas.push(i + 1);
    });
  return malas;
}

describe("G1: el nombre del puesto en los textos sale de core/pos/puesto.ts", () => {
  const rutas = CARPETAS.flatMap((c) => archivos(join(RAIZ, c)));

  it("encuentra los archivos del POS", () => {
    expect(rutas.length).toBeGreaterThan(40);
  });

  it("ningún archivo del POS arma «Mesa ${…}» a mano", () => {
    const problemas: string[] = [];
    for (const ruta of rutas) {
      const nombre = relative(RAIZ, ruta).split(sep).join("/");
      for (const linea of lineasConTextoDeMesaAMano(readFileSync(ruta, "utf8"))) problemas.push(`${nombre}:${linea}`);
    }
    expect(problemas, `Estas líneas arman el nombre del puesto a mano; usá frasesDePuesto o rotuloDePuesto (src/core/pos/puesto.ts):\n${problemas.join("\n")}`).toEqual([]);
  });

  it("el detector reconoce lo que prohíbe y deja pasar lo que no", () => {
    expect(lineasConTextoDeMesaAMano("const a = `Mesa ${mesa}`;")).toEqual([1]);
    expect(lineasConTextoDeMesaAMano("x\nconst a = `La cuenta de la mesa ${n} ya se cerró`;")).toEqual([2]);
    expect(lineasConTextoDeMesaAMano("<h1>Mesa {numero}</h1>")).toEqual([1]);
    expect(lineasConTextoDeMesaAMano(" * Mesa ${n} es un ejemplo en un comentario")).toEqual([]);
    expect(lineasConTextoDeMesaAMano("const a = frasesDePuesto(n).detalle;")).toEqual([]);
  });
});
