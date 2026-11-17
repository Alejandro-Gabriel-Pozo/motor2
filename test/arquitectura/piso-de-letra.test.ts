import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RAIZ_DEL_REPO } from "./cercos/trinquete";

/**
 * Piso de letra (Frente «Visual», V1; mandato del dueño 2026-11-17, igual que Pedernal `ui/tokens.css`): ninguna medida `--text-<nombre>: <n>rem|px` declarada en
 * `src/app/globals.css` baja de 1rem (16 px). Lee los literales de `globals.css`, sin comentarios; las `--text-*--line-height` no son medidas de letra y no cuentan.
 * Límite: mide lo declarado en ese archivo, no lo que un componente escriba a mano (eso lo cuenta `cerco-tipografia.test.ts`).
 */
const CSS = readFileSync(join(RAIZ_DEL_REPO, "src/app/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const RE_MEDIDA = /(?<![\w-])--text-([a-z0-9]+)\s*:\s*(\d*\.?\d+)(rem|px)\s*;/g;

function enPx(valor: number, unidad: string): number {
  return unidad === "rem" ? valor * 16 : valor;
}

describe("piso de letra de 16 px", () => {
  const medidas = [...CSS.matchAll(RE_MEDIDA)].map((m) => ({ nombre: m[1], px: enPx(Number(m[2]), m[3]) }));

  it("declara las dos medidas chicas de la escala (si no, Tailwind usaría 12 y 14 px)", () => {
    expect(medidas.map((m) => m.nombre)).toEqual(expect.arrayContaining(["xs", "sm"]));
  });

  it("ninguna --text-* declarada baja de 16 px", () => {
    expect(medidas.filter((m) => m.px < 16)).toEqual([]);
  });
});
