import type { ReactElement } from "react";
import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Selector } from "../../src/ui/primitivas/selector";

/**
 * Contrato de `Selector` (src/ui/primitivas/selector.tsx, contrato `primitiva-selector`): el `<select>` nativo con la misma envoltura que `Campo`: etiqueta obligatoria y atada con `htmlFor`,
 * ayuda y error conectados con `aria-describedby`, el error UNA sola vez con `role="alert"`, tamaño compacto desde `md:`, solo tokens, sin modo oscuro y `ref` hasta el `<select>`.
 * Entorno de Vitest = Node: se mira el HTML del servidor.
 */
const clasesDe = (html: string, etiqueta: string): string[] => (new RegExp(`<${etiqueta}[^>]*class="([^"]*)"`).exec(html)?.[1] ?? "").split(/\s+/).filter(Boolean);

const opciones = [
  <option key="a" value="a">
    Rojo
  </option>,
  <option key="b" value="b">
    Azul
  </option>,
];

describe("Selector", () => {
  it("la etiqueta está atada al <select> por htmlFor/id y las opciones son las que pasa quien lo usa", () => {
    const html = renderToStaticMarkup(
      <Selector etiqueta="Color" name="color" defaultValue="b">
        {opciones}
      </Selector>,
    );
    const para = /<label for="([^"]+)"/.exec(html)?.[1];
    expect(para).toBeTruthy();
    expect(html).toMatch(new RegExp(`<select[^>]* id="${para}"`));
    expect(html).toContain('name="color"');
    expect(html).toContain('<option value="a">Rojo</option>');
    expect(html).toContain('<option value="b" selected="">Azul</option>');
    expect(html).not.toContain("aria-invalid");
    expect(html).not.toContain("aria-describedby");
  });

  it("la etiqueta es OBLIGATORIA: omitirla no compila (un selector sin nombre no existe para un lector de pantalla)", () => {
    // @ts-expect-error falta `etiqueta`: si compilara, el tipo no estaría protegiendo nada.
    const elemento: ReactElement = <Selector name="sin-etiqueta">{opciones}</Selector>;
    expect(elemento.type).toBe(Selector);
  });

  it("dos selectores en la misma pantalla no comparten id; un id explícito manda", () => {
    const dos = renderToStaticMarkup(
      <>
        <Selector etiqueta="A">{opciones}</Selector>
        <Selector etiqueta="B">{opciones}</Selector>
      </>,
    );
    const ids = [...dos.matchAll(/<select[^>]* id="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(2);
    expect(renderToStaticMarkup(<Selector etiqueta="A" id="sel-color">{opciones}</Selector>)).toContain('<label for="sel-color"');
  });

  it("con ayuda y error: aria-describedby los apunta, aria-invalid, y el error aparece UNA sola vez con role=alert", () => {
    const html = renderToStaticMarkup(
      <Selector etiqueta="Color" ayuda="Elegí uno" error="Elegí un color de la lista">
        {opciones}
      </Selector>,
    );
    expect(html).toContain('aria-invalid="true"');
    const ids = (/aria-describedby="([^"]+)"/.exec(html)?.[1] ?? "").split(" ");
    expect(ids).toHaveLength(2);
    for (const id of ids) expect(html, id).toContain(`<p id="${id}"`);
    expect([...html.matchAll(/role="alert"/g)]).toHaveLength(1);
    expect([...html.matchAll(/Elegí un color de la lista/g)]).toHaveLength(1);
    expect(/<label[^>]*>(.*?)<\/label>/.exec(html)?.[1]).toBe("Color");
  });

  it("required: asterisco decorativo y el atributo en el <select>", () => {
    const html = renderToStaticMarkup(
      <Selector etiqueta="Color" required>
        {opciones}
      </Selector>,
    );
    expect(html).toContain('<span aria-hidden="true"> *</span>');
    expect(html).toMatch(/<select[^>]*\srequired(=""|\s|>)/);
  });

  it("etiquetaOculta: la etiqueta existe, atada, solo para lectores de pantalla (sr-only)", () => {
    const html = renderToStaticMarkup(
      <Selector etiqueta="Color" etiquetaOculta>
        {opciones}
      </Selector>,
    );
    expect(clasesDe(html, "label")).toEqual(["sr-only"]);
    expect(html).toContain(">Color</label>");
  });

  it("clases de tokens (borde de control, o de error), tamaño normal o compacto desde md:, 44 px en celular; nunca sm:, modo oscuro ni colores de escala", () => {
    const sinError = clasesDe(renderToStaticMarkup(<Selector etiqueta="x">{opciones}</Selector>), "select");
    for (const clase of ["border-borde-control", "bg-superficie", "text-tinta", "focus-visible:outline-foco", "disabled:bg-superficie-suave", "disabled:text-tinta-tenue", "min-h-11", "md:min-h-9"]) {
      expect(sinError, clase).toContain(clase);
    }
    expect(clasesDe(renderToStaticMarkup(<Selector etiqueta="x" tamano="compacto">{opciones}</Selector>), "select")).toContain("md:min-h-8");
    const conError = clasesDe(renderToStaticMarkup(<Selector etiqueta="x" error="mal">{opciones}</Selector>), "select");
    expect(conError).toContain("border-error");
    expect(conError).not.toContain("border-borde-control");
    const html = renderToStaticMarkup(
      <Selector etiqueta="x" ayuda="a" error="e">
        {opciones}
      </Selector>,
    );
    expect(html).not.toMatch(/(^|[\s":])dark:/);
    expect(html).not.toMatch(/(^|[\s":])sm:/);
    expect(html).not.toMatch(/(^|[\s":-])(?:neutral|gray|slate|zinc|stone|red|white|black)-\d/);
  });

  it("className se suma al final sin quitar las clases del sistema", () => {
    const clases = clasesDe(renderToStaticMarkup(<Selector etiqueta="x" className="w-40">{opciones}</Selector>), "select");
    expect(clases[clases.length - 1]).toBe("w-40");
    expect(clases).toContain("min-h-11");
  });

  it("acepta ref (React 19: una prop más) y la deja en el <select>", () => {
    const ref = createRef<HTMLSelectElement>();
    const envoltura = Selector({ etiqueta: "x", ref, children: opciones }) as ReactElement<{
      children: (c: { id: string; "aria-describedby": undefined; "aria-invalid": undefined; className: string }) => ReactElement;
    }>;
    const select = envoltura.props.children({ id: "i", "aria-describedby": undefined, "aria-invalid": undefined, className: "" });
    expect(select.type).toBe("select");
    expect((select.props as { ref: unknown }).ref).toBe(ref);
  });
});
