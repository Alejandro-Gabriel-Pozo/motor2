import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regla de accesibilidad (axe `empty-table-header`, WCAG 1.3.1): un `<th>` sin texto deja a un lector de pantalla sin nombre para esa
 * columna. La columna de botones («Desactivar», «Guardar») es la que solía quedar así: `<th />`. Se escribe `<th><span className="sr-only">Acciones</span></th>`.
 *
 * Es estático (mira el JSX, no lo renderiza): cubre también los encabezados que solo aparecen con ciertos datos, que un spec de axe no ve si
 * no siembra ese caso. El render real de las pantallas lo sigue cubriendo `test/e2e/accesibilidad.spec.ts`.
 */
const RAIZ = join(__dirname, "../../src");

function tsx(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    return statSync(ruta).isDirectory() ? tsx(ruta) : ruta.endsWith(".tsx") ? [ruta] : [];
  });
}

/** `<th />`, `<th className="x" />` y `<th></th>` (con o sin espacios adentro). Los `<th>` con hijos, aunque sean un span, no matchean. */
const ENCABEZADO_VACIO = /<th(?:\s[^<>]*?)?\s*\/>|<th(?:\s[^<>]*?)?>\s*<\/th>/g;

/**
 * `<td>`/`<th>` con `display` propio (flex, grid, block...): deja de ser celda de tabla y se desalinea de su columna. El flex va en un `<div>` adentro.
 * Solo se mira la clase del `<td>`/`<th>` mismo, no las de sus hijos.
 */
const CELDA_CON_DISPLAY = /<t[dh]\s[^>]*?className="(?:[^"]*\s)?(?:flex|inline-flex|grid|inline-grid|block|inline-block)(?:\s[^"]*)?"/g;

describe("tablas: ninguna celda con display propio", () => {
  it("la expresión distingue celdas con display de las normales", () => {
    const hay = (t: string) => (t.match(CELDA_CON_DISPLAY) ?? []).length;
    expect(hay('<td className="flex gap-3">')).toBe(1);
    expect(hay('<td className="px-2 block">')).toBe(1);
    expect(hay('<th className="grid">')).toBe(1);
    expect(hay('<td className="px-2 py-2">')).toBe(0);
    expect(hay('<td><div className="flex gap-3"></div></td>')).toBe(0);
    expect(hay('<td className="flexible">')).toBe(0);
  });

  it("ningún archivo de src/ tiene una celda de tabla con display propio", () => {
    const malas = tsx(RAIZ).flatMap((ruta) => {
      const fuente = readFileSync(ruta, "utf8").replace(/\r\n/g, "\n");
      return [...fuente.matchAll(CELDA_CON_DISPLAY)].map((m) => `${relative(RAIZ, ruta).replaceAll("\\", "/")}:${fuente.slice(0, m.index).split("\n").length}`);
    });
    expect(malas, "poner el flex en un <div> dentro de la celda").toEqual([]);
  });
});

describe("tablas: ningún <th> vacío", () => {
  it("la expresión distingue vacíos de con contenido", () => {
    const hay = (s: string) => (s.match(ENCABEZADO_VACIO) ?? []).length;
    expect(hay("<th />")).toBe(1);
    expect(hay('<th className="px-2" />')).toBe(1);
    expect(hay("<th></th>")).toBe(1);
    expect(hay('<th className="px-2"> </th>')).toBe(1);
    expect(hay("<th>Nombre</th>")).toBe(0);
    expect(hay('<th><span className="sr-only">Acciones</span></th>')).toBe(0);
    expect(hay("<th>{titulo}</th>")).toBe(0);
  });

  it("ningún archivo de src/ tiene un encabezado de tabla sin texto", () => {
    const vacios = tsx(RAIZ).flatMap((ruta) => {
      const fuente = readFileSync(ruta, "utf8").replace(/\r\n/g, "\n");
      return [...fuente.matchAll(ENCABEZADO_VACIO)].map((m) => `${relative(RAIZ, ruta).replaceAll("\\", "/")}:${fuente.slice(0, m.index).split("\n").length}`);
    });
    expect(vacios, "encabezados <th> vacíos: usar <th><span className=\"sr-only\">Acciones</span></th>").toEqual([]);
  });
});
