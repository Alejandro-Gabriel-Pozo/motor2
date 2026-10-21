import type { ReactElement } from "react";
import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Insignia, type TonoDeInsignia } from "../../src/ui/primitivas/insignia";

/**
 * Contrato de `Insignia` (src/ui/primitivas/insignia.tsx, contrato `primitiva-insignia`): una etiqueta corta con tono (neutro, ok, aviso, error, marca) que SIEMPRE lleva texto: `children` es un
 * `string` y vacío o de solo espacios es un error en ejecución. Solo tokens (el par de `marca` sobre `marca-tinte`, el token que nace con ella, está medido en
 * `test/arquitectura/tokens-del-sistema-visual.test.ts`), sin modo oscuro y `ref` hasta el `<span>`. Entorno de Vitest = Node: se mira el HTML del servidor.
 */
const clasesDe = (html: string): string[] => (/<span[^>]*class="([^"]*)"/.exec(html)?.[1] ?? "").split(/\s+/).filter(Boolean);

const TONOS: readonly (readonly [TonoDeInsignia, string, string])[] = [
  ["neutro", "bg-superficie-suave", "text-tinta-suave"],
  ["ok", "bg-ok-tinte", "text-ok-tinta"],
  ["aviso", "bg-aviso-tinte", "text-aviso-tinta"],
  ["error", "bg-error-tinte", "text-error"],
  ["marca", "bg-marca-tinte", "text-marca"],
];

describe("Insignia", () => {
  it("dibuja el texto en un <span> y deja pasar los atributos de un <span>", () => {
    const html = renderToStaticMarkup(
      <Insignia id="estado" title="Estado del producto" data-prueba="x">
        Activo
      </Insignia>,
    );
    expect(html).toMatch(/^<span /);
    expect(html).toContain(">Activo</span>");
    expect(html).toContain('id="estado"');
    expect(html).toContain('title="Estado del producto"');
    expect(html).toContain('data-prueba="x"');
  });

  it.each(TONOS)("tono %s: fondo %s y texto %s (tokens)", (tono, fondo, texto) => {
    const c = clasesDe(renderToStaticMarkup(<Insignia tono={tono}>Algo</Insignia>));
    expect(c).toContain(fondo);
    expect(c).toContain(texto);
    for (const base of ["inline-flex", "rounded-full", "px-2", "py-0.5", "text-xs", "font-medium"]) expect(c, base).toContain(base);
  });

  it("sin tono es neutro", () => {
    expect(renderToStaticMarkup(<Insignia>Algo</Insignia>)).toBe(renderToStaticMarkup(<Insignia tono="neutro">Algo</Insignia>));
  });

  it("el texto es OBLIGATORIO en el tipo: omitirlo, o pasarle algo que no es un string, no compila", () => {
    // @ts-expect-error falta `children`: si compilara, el tipo no estaría protegiendo nada.
    const sinTexto: ReactElement = <Insignia tono="ok" />;
    expect(sinTexto.type).toBe(Insignia);
    // @ts-expect-error un elemento no es un string: la insignia es texto, no un contenedor.
    const conElemento: ReactElement = <Insignia><b>Activo</b></Insignia>;
    expect(conElemento.type).toBe(Insignia);
  });

  it.each([[""], [" "], ["   "], ["\n\t "]])("texto vacío o de solo espacios (%j): error en ejecución que lo explica", (vacio) => {
    expect(() => renderToStaticMarkup(<Insignia>{vacio}</Insignia>)).toThrow(/Insignia: el texto es obligatorio/);
  });

  it("un texto con espacios alrededor se acepta tal cual (hay algo escrito)", () => {
    expect(renderToStaticMarkup(<Insignia> Activo </Insignia>)).toContain("> Activo </span>");
  });

  it("className se suma al final sin quitar las clases del sistema", () => {
    const c = clasesDe(renderToStaticMarkup(<Insignia className="ml-2">Algo</Insignia>));
    expect(c[c.length - 1]).toBe("ml-2");
    expect(c).toContain("rounded-full");
  });

  it("nunca trae sm:, modo oscuro ni colores de escala, en ningún tono", () => {
    for (const [tono] of TONOS) {
      const html = renderToStaticMarkup(<Insignia tono={tono}>Algo</Insignia>);
      expect(html, tono).not.toMatch(/(^|[\s":])dark:/);
      expect(html, tono).not.toMatch(/(^|[\s":])sm:/);
      expect(html, tono).not.toMatch(/(^|[\s":-])(?:neutral|gray|slate|zinc|stone|red|green|amber|yellow|blue|white|black)-\d/);
    }
  });

  it("acepta ref (React 19: una prop más) y la deja en el <span>", () => {
    const ref = createRef<HTMLSpanElement>();
    const insignia = Insignia({ ref, children: "Activo" }) as ReactElement;
    expect(insignia.type).toBe("span");
    expect((insignia.props as { ref: unknown }).ref).toBe(ref);
  });
});
