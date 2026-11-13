import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * La paleta de la consola de plataforma es la del sistema (paso 15 de la auditoría 2026-11-12; decisión del dueño, 2026-11-12: la consola es «parte del sistema»). La consola es otra app y no puede
 * importar `src/app/globals.css`, así que repite los valores; este test falla si algún color de `plataforma/src/app/globals.css` deja de coincidir con el token del sistema que declara en su comentario
 * (un comentario al lado, por ejemplo «--color-papel»), o si aparece un color sin token declarado. LÍMITES: mira las variables de `:root` de ese archivo; un color literal escrito en otra regla de CSS o en un componente lo vigila el
 * cerco de colores, no este test.
 */
const SISTEMA = readFileSync("src/app/globals.css", "utf8");
const CONSOLA = readFileSync("plataforma/src/app/globals.css", "utf8");

function tokensDelSistema(): Map<string, string> {
  const bloque = SISTEMA.slice(SISTEMA.indexOf("@theme static"));
  return new Map([...bloque.matchAll(/--color-([a-z-]+):\s*(#[0-9A-Fa-f]{6})\s*;/g)].map((m) => [m[1], m[2].toUpperCase()]));
}

const raiz = CONSOLA.slice(CONSOLA.indexOf(":root"), CONSOLA.indexOf("}", CONSOLA.indexOf(":root")));
const coloresDeLaConsola = [...raiz.matchAll(/--([a-z-]+):\s*(#[0-9A-Fa-f]{3,8})\s*;(?:\s*\/\*\s*--color-([a-z-]+)\s*\*\/)?/g)];

describe("paleta de la consola de plataforma", () => {
  it("tiene colores en :root (el test no mira un archivo vacío)", () => {
    expect(coloresDeLaConsola.length).toBeGreaterThanOrEqual(8);
  });

  it("cada color declara el token del sistema del que sale", () => {
    const sinToken = coloresDeLaConsola.filter((m) => !m[3]).map((m) => `--${m[1]}: ${m[2]}`);
    expect(sinToken, "colores de la consola sin token del sistema declarado en su comentario").toEqual([]);
  });

  it("cada color vale lo mismo que su token del sistema", () => {
    const sistema = tokensDelSistema();
    for (const m of coloresDeLaConsola) {
      const token = m[3];
      expect(sistema.has(token), `el token --color-${token} no existe en el sistema`).toBe(true);
      expect(m[2].toUpperCase(), `--${m[1]} de la consola contra --color-${token} del sistema`).toBe(sistema.get(token));
    }
  });
});
