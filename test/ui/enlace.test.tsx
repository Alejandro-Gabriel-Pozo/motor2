import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Enlace, type VarianteDeEnlace } from "../../src/ui/primitivas/enlace";

/**
 * Contrato de `Enlace` (src/ui/primitivas/enlace.tsx, contrato `primitiva-enlace`): `next/link` con la variante `texto` (por defecto, subrayado con tokens y foco del sistema) o `sin-estilo` (ninguna
 * clase propia), `className` al final y todo lo demás de `next/link`. Solo tokens, sin modo oscuro. Entorno de Vitest = Node: se mira el HTML del servidor.
 */
const clasesDe = (html: string): string[] => (/<a[^>]*class="([^"]*)"/.exec(html)?.[1] ?? "").split(/\s+/).filter(Boolean);

describe("Enlace", () => {
  it("es un <a> con el href y deja pasar sus atributos (target, rel, aria-*)", () => {
    const html = renderToStaticMarkup(
      <Enlace href="/catalogo/productos" target="_blank" rel="noopener" aria-label="Ir al catálogo" prefetch={false}>
        Catálogo
      </Enlace>,
    );
    expect(html).toMatch(/^<a /);
    expect(html).toContain('href="/catalogo/productos"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener"');
    expect(html).toContain('aria-label="Ir al catálogo"');
    expect(html).toContain(">Catálogo</a>");
  });

  it("el href es OBLIGATORIO (es el de next/link): omitirlo no compila", () => {
    // @ts-expect-error falta `href`: si compilara, el tipo no estaría protegiendo nada.
    const elemento: ReactElement = <Enlace>Sin destino</Enlace>;
    expect(elemento.type).toBe(Enlace);
  });

  it("la variante texto es la de por defecto: subrayado con tokens y el foco del sistema", () => {
    const html = renderToStaticMarkup(<Enlace href="/a">x</Enlace>);
    expect(html).toBe(renderToStaticMarkup(<Enlace href="/a" variante="texto">x</Enlace>));
    const c = clasesDe(html);
    for (const clase of ["text-tinta-suave", "underline", "hover:text-tinta", "focus-visible:outline-2", "focus-visible:outline-offset-2", "focus-visible:outline-foco"]) expect(c, clase).toContain(clase);
  });

  it("la variante sin-estilo no agrega ninguna clase: solo la del que la usa", () => {
    expect(renderToStaticMarkup(<Enlace href="/a" variante="sin-estilo">x</Enlace>)).not.toContain("class=");
    expect(clasesDe(renderToStaticMarkup(<Enlace href="/a" variante="sin-estilo" className="block rounded border border-borde p-3">x</Enlace>))).toEqual(["block", "rounded", "border", "border-borde", "p-3"]);
  });

  it("className se suma al final de la variante sin quitarle nada", () => {
    const c = clasesDe(renderToStaticMarkup(<Enlace href="/a" className="font-medium">x</Enlace>));
    expect(c[c.length - 1]).toBe("font-medium");
    expect(c).toContain("underline");
  });

  it("nunca trae sm:, modo oscuro ni colores de escala, en ninguna variante", () => {
    for (const variante of ["texto", "sin-estilo"] as const satisfies readonly VarianteDeEnlace[]) {
      const html = renderToStaticMarkup(<Enlace href="/a" variante={variante} className="p-1">x</Enlace>);
      expect(html, variante).not.toMatch(/(^|[\s":])dark:/);
      expect(html, variante).not.toMatch(/(^|[\s":])sm:/);
      expect(html, variante).not.toMatch(/(^|[\s":-])(?:neutral|gray|slate|zinc|stone|red|green|amber|yellow|blue|white|black)-\d/);
    }
  });

  it("la variante no llega al <a> como atributo", () => {
    expect(renderToStaticMarkup(<Enlace href="/a" variante="sin-estilo">x</Enlace>)).not.toContain("variante");
  });
});
