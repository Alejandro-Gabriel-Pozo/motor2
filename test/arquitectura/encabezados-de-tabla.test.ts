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
