import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Defensa por defecto del color de los bordes de la carta (`src/app/globals.css`). El preflight de Tailwind resetea cada borde con `border: 0 solid` y un borde sin color
 * declarado cae a `currentColor`, el color del TEXTO (negro): el bug de los separadores negros de C12. La red de seguridad: dentro de `@layer base`, todo lo que está en
 * `.carta-shell` (y sus `::before`/`::after`) arranca con `border-color: var(--carta-border)`. Va en la capa `base` a propósito: no le gana a las utilidades de Tailwind (capa
 * `utilities`: `border-red-500`) ni a las reglas centrales sin capa (`carta-divisor`, `carta-borde`).
 * Es SOLO la red: que cada separador declare `carta-divisor` / `carta-borde` lo exigen los contratos `separador-de-lista-de-carta` y `borde-propio-de-carta`
 * (`test/arquitectura/contratos/`).
 * Mutación demostrada (rojo y revertida; ver `logs/contratos/g3b-demostraciones.txt`): sacar la regla, o sacarla de `@layer base`.
 */
const CSS = readFileSync(join(__dirname, "../../src/app/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** El cuerpo de cada bloque `@layer <nombre> { … }` (con las llaves balanceadas) y el CSS que queda fuera de TODA capa. */
function porCapas(css: string, nombre: string): { dentro: string[]; fuera: string } {
  const dentro: string[] = [];
  let fuera = "";
  const apertura = new RegExp(String.raw`@layer\s+${nombre}\s*\{`, "g");
  let cursor = 0;
  for (let m = apertura.exec(css); m; m = apertura.exec(css)) {
    let profundidad = 1;
    let i = m.index + m[0].length;
    for (; i < css.length && profundidad > 0; i++) profundidad += css[i] === "{" ? 1 : css[i] === "}" ? -1 : 0;
    fuera += css.slice(cursor, m.index);
    dentro.push(css.slice(m.index + m[0].length, i - 1));
    cursor = i;
    apertura.lastIndex = i;
  }
  return { dentro, fuera: fuera + css.slice(cursor) };
}

/** Las reglas planas `selector { declaraciones }` de un trozo de CSS (sin anidar). */
function reglas(css: string): { selectores: string[]; cuerpo: string }[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selectores: m[1]!.split(",").map((s) => s.trim().replace(/\s+/g, " ")), cuerpo: m[2]!.replace(/\s+/g, " ").trim() }));
}

const COLOR_POR_DEFECTO = /(?:^|;|\s)border-color:\s*var\(--carta-border\)\s*;?$/;

describe("la carta: un borde sin color declarado cae al color de borde de la carta, nunca al del texto", () => {
  const base = porCapas(CSS, "base");

  it("la regla por defecto existe DENTRO de `@layer base` y cubre `.carta-shell`, todo lo que contiene y sus `::before` / `::after`", () => {
    const encontradas = base.dentro.flatMap(reglas).filter((r) => COLOR_POR_DEFECTO.test(r.cuerpo));
    const selectores = new Set(encontradas.flatMap((r) => r.selectores));
    expect([...selectores].sort()).toEqual([".carta-shell", ".carta-shell *", ".carta-shell ::after", ".carta-shell ::before"]);
  });

  it("no hay otra regla por defecto fuera de la capa `base` (sin capa le ganaría a las utilidades de Tailwind)", () => {
    const sueltas = reglas(base.fuera).filter((r) => r.selectores.some((s) => /^\.carta-shell(?: \*| ::(?:before|after))?$/.test(s)) && /border-color/.test(r.cuerpo));
    expect(sueltas).toEqual([]);
  });

  it("las reglas centrales `carta-divisor` y `carta-borde` siguen SIN capa: le ganan a la defensa por defecto", () => {
    const sinCapa = reglas(base.fuera).filter((r) => COLOR_POR_DEFECTO.test(r.cuerpo)).flatMap((r) => r.selectores);
    expect(sinCapa).toEqual(expect.arrayContaining([".carta-shell .carta-divisor > *", ".carta-shell .carta-borde"]));
  });
});
