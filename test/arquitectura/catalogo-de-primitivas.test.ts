import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * El catálogo de primitivas de negocio de Motor2 (`docs/catalogo-de-primitivas-motor2.md`, paso 14 de la auditoría 2026-11-12; pedido del dueño: «Motor2 debe tener su propio catálogo de
 * primitivas e invariantes») tiene que decir a qué primitiva pertenece CADA modelo de `prisma/schema.prisma`. Falla si un modelo nuevo no figura en la tabla «Modelos por primitiva» (hay que
 * agregarlo en el mismo PR, con su primitiva) o si la tabla nombra un modelo que ya no existe (hay que sacarlo). LÍMITES: comprueba nombres, no que la primitiva elegida sea la correcta ni que
 * el detalle de la primitiva esté al día; un modelo renombrado en el esquema y en la tabla a la vez pasa. Es una alarma para errores honestos, no una auditoría.
 */
const ESQUEMA = readFileSync("prisma/schema.prisma", "utf8");
const CATALOGO = readFileSync("docs/catalogo-de-primitivas-motor2.md", "utf8");

export function modelosDelEsquema(esquema: string): string[] {
  return [...esquema.matchAll(/^model (\w+) \{/gm)].map((m) => m[1]);
}

export function modelosDelCatalogo(catalogo: string): Map<string, string> {
  const inicio = catalogo.indexOf("## Modelos por primitiva");
  if (inicio < 0) return new Map();
  const filas = [...catalogo.slice(inicio).matchAll(/^\| `(\w+)` \| ([^|\n]+?) \|$/gm)];
  return new Map(filas.map((m) => [m[1], m[2]]));
}

describe("catálogo de primitivas: el detector", () => {
  it("lee los modelos de un esquema", () => {
    expect(modelosDelEsquema("model A {\n  id String\n}\n\nmodel Bb {\n}\nenum E {\n}")).toEqual(["A", "Bb"]);
  });

  it("lee las filas de la tabla «Modelos por primitiva» y no otras tablas", () => {
    const md = "| `NoEsModelo` | x |\n\n## Modelos por primitiva\n\n| Modelo | Primitiva |\n|---|---|\n| `Cliente` | Cliente |\n| `Producto` | Producto |\n";
    expect([...modelosDelCatalogo(md).keys()]).toEqual(["Cliente", "Producto"]);
  });
});

describe("catálogo de primitivas: cada modelo del esquema tiene su primitiva", () => {
  const delEsquema = modelosDelEsquema(ESQUEMA);
  const delCatalogo = modelosDelCatalogo(CATALOGO);

  it("el esquema tiene modelos y el catálogo tiene filas (el test no mira un archivo vacío)", () => {
    expect(delEsquema.length).toBeGreaterThan(100);
    expect(delCatalogo.size).toBeGreaterThan(100);
  });

  it("ningún modelo del esquema falta en el catálogo", () => {
    const sinCatalogar = delEsquema.filter((m) => !delCatalogo.has(m));
    expect(sinCatalogar, "modelos nuevos sin primitiva en docs/catalogo-de-primitivas-motor2.md («Modelos por primitiva»)").toEqual([]);
  });

  it("el catálogo no nombra modelos que ya no existen", () => {
    const sobran = [...delCatalogo.keys()].filter((m) => !delEsquema.includes(m));
    expect(sobran, "modelos del catálogo que ya no están en prisma/schema.prisma").toEqual([]);
  });

  it("ningún modelo figura dos veces", () => {
    const filas = [...CATALOGO.slice(CATALOGO.indexOf("## Modelos por primitiva")).matchAll(/^\| `(\w+)` \|/gm)].map((m) => m[1]);
    expect(filas.length).toBe(new Set(filas).size);
  });
});
