import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LecturaEnVivo, type TonoDeLectura } from "../../src/ui/componentes/datos/lectura-en-vivo";

/**
 * `LecturaEnVivo` (src/ui/componentes/datos/lectura-en-vivo.tsx, Fase 6, paso 6.10a): la línea que dice cómo se entendió lo tecleado. Región `aria-live="polite"` que SIEMPRE está en el árbol,
 * con tono lectura | advertencia | error, solo tokens y sin `role="alert"`. Entorno de Vitest = Node: se mira el HTML del servidor.
 */
const clasesDe = (html: string): string[] => (/^<div[^>]*class="([^"]*)"/.exec(html)?.[1] ?? "").split(/\s+/).filter(Boolean);

const TONOS: readonly (readonly [TonoDeLectura, readonly string[]])[] = [
  ["lectura", ["text-tinta-suave"]],
  ["advertencia", ["border-aviso", "bg-aviso-tinte", "text-aviso-tinta"]],
  ["error", ["text-error"]],
];

describe("LecturaEnVivo", () => {
  it("es una región aria-live polite que dibuja lo que se le pasa", () => {
    const html = renderToStaticMarkup(<LecturaEnVivo>= 300 g</LecturaEnVivo>);
    expect(html).toMatch(/^<div /);
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("= 300 g");
  });

  it("sin contenido la región sigue en el árbol (un lector no anuncia una región que aparece junto con su texto)", () => {
    expect(renderToStaticMarkup(<LecturaEnVivo />)).toContain('aria-live="polite"');
  });

  it.each(TONOS)("tono %s: sus tokens y el tono en data-tono", (tono, esperadas) => {
    const html = renderToStaticMarkup(<LecturaEnVivo tono={tono}>Algo</LecturaEnVivo>);
    for (const clase of esperadas) expect(clasesDe(html), clase).toContain(clase);
    expect(html).toContain(`data-tono="${tono}"`);
  });

  it("sin tono es una lectura", () => {
    expect(renderToStaticMarkup(<LecturaEnVivo>Algo</LecturaEnVivo>)).toBe(renderToStaticMarkup(<LecturaEnVivo tono="lectura">Algo</LecturaEnVivo>));
  });

  it("la advertencia lleva su «⚠» oculto al lector y el texto aparte: el color no es lo único que la marca", () => {
    const html = renderToStaticMarkup(<LecturaEnVivo tono="advertencia">Revisá el importe</LecturaEnVivo>);
    expect(html).toContain('<span aria-hidden="true">⚠</span>');
    expect(html).toContain("<span>Revisá el importe</span>");
  });

  it("el error NO es role=alert: se lee mientras se teclea y no puede interrumpir a cada letra", () => {
    const html = renderToStaticMarkup(<LecturaEnVivo tono="error">No se entendió</LecturaEnVivo>);
    expect(html).not.toContain("role=");
  });

  it("deja pasar un id y un data-… para quien la apunta desde un test o un aria-describedby, pero no className, role ni aria-live", () => {
    const html = renderToStaticMarkup(<LecturaEnVivo id="lectura-1" data-lectura-de="precio">Algo</LecturaEnVivo>);
    expect(html).toContain('id="lectura-1"');
    expect(html).toContain('data-lectura-de="precio"');
    // @ts-expect-error la clase es del tono: el tipo no deja pintarla desde afuera.
    const conClase = <LecturaEnVivo className="text-red-700">Algo</LecturaEnVivo>;
    // @ts-expect-error el rol y la cortesía de la región no se cambian.
    const conRol = <LecturaEnVivo role="alert" aria-live="assertive">Algo</LecturaEnVivo>;
    // El valor pasado por afuera nunca pisa al de la región (si el tipo se saltea, el componente igual manda).
    expect(renderToStaticMarkup(conRol)).toContain('aria-live="polite"');
    expect(renderToStaticMarkup(conClase)).not.toContain("text-red-700");
  });

  it("nunca trae modo oscuro, sm: ni colores de escala, en ningún tono", () => {
    for (const [tono] of TONOS) {
      const html = renderToStaticMarkup(<LecturaEnVivo tono={tono}>Algo</LecturaEnVivo>);
      expect(html, tono).not.toMatch(/(^|[\s":])dark:/);
      expect(html, tono).not.toMatch(/(^|[\s":-])(?:neutral|gray|slate|zinc|stone|red|green|amber|yellow|blue|white|black)-\d/);
    }
  });
});
