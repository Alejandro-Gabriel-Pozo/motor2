import type { ReactElement } from "react";
import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AreaDeTexto } from "../../src/ui/primitivas/area-de-texto";

/**
 * Contrato de `AreaDeTexto` (src/ui/primitivas/area-de-texto.tsx, contrato `primitiva-area-de-texto`): el `<textarea>` con la misma envoltura que `Campo`: etiqueta obligatoria y atada con
 * `htmlFor`, ayuda y error conectados con `aria-describedby`, el error UNA sola vez con `role="alert"`, piso de 44 px en celular, solo tokens, sin modo oscuro y `ref` hasta el `<textarea>`.
 * Entorno de Vitest = Node: se mira el HTML del servidor.
 */
const clasesDe = (html: string, etiqueta: string): string[] => (new RegExp(`<${etiqueta}[^>]*class="([^"]*)"`).exec(html)?.[1] ?? "").split(/\s+/).filter(Boolean);

describe("AreaDeTexto", () => {
  it("la etiqueta está atada al <textarea> por htmlFor/id y deja pasar sus atributos; tiene 3 filas por defecto", () => {
    const html = renderToStaticMarkup(<AreaDeTexto etiqueta="Observaciones" name="obs" maxLength={200} defaultValue="Sin sal" />);
    const para = /<label for="([^"]+)"/.exec(html)?.[1];
    expect(para).toBeTruthy();
    expect(html).toMatch(new RegExp(`<textarea[^>]* id="${para}"`));
    expect(html).toContain('name="obs"');
    expect(html).toContain('maxLength="200"');
    expect(html).toContain('rows="3"');
    expect(html).toContain(">Sin sal</textarea>");
    expect(html).not.toContain("aria-invalid");
    expect(html).not.toContain("aria-describedby");
    expect(renderToStaticMarkup(<AreaDeTexto etiqueta="x" rows={6} />)).toContain('rows="6"');
  });

  it("la etiqueta es OBLIGATORIA: omitirla no compila", () => {
    // @ts-expect-error falta `etiqueta`: si compilara, el tipo no estaría protegiendo nada.
    const elemento: ReactElement = <AreaDeTexto name="sin-etiqueta" />;
    expect(elemento.type).toBe(AreaDeTexto);
  });

  it("dos áreas en la misma pantalla no comparten id; un id explícito manda", () => {
    const dos = renderToStaticMarkup(
      <>
        <AreaDeTexto etiqueta="A" />
        <AreaDeTexto etiqueta="B" />
      </>,
    );
    const ids = [...dos.matchAll(/<textarea[^>]* id="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(2);
    expect(renderToStaticMarkup(<AreaDeTexto etiqueta="A" id="area-nota" />)).toContain('<label for="area-nota"');
  });

  it("con ayuda y error: aria-describedby los apunta, aria-invalid, y el error aparece UNA sola vez con role=alert, fuera de la etiqueta", () => {
    const html = renderToStaticMarkup(<AreaDeTexto etiqueta="Observaciones" ayuda="Hasta 200 caracteres" error="Escribí menos de 200 caracteres" />);
    expect(html).toContain('aria-invalid="true"');
    const ids = (/aria-describedby="([^"]+)"/.exec(html)?.[1] ?? "").split(" ");
    expect(ids).toHaveLength(2);
    for (const id of ids) expect(html, id).toContain(`<p id="${id}"`);
    expect([...html.matchAll(/role="alert"/g)]).toHaveLength(1);
    expect([...html.matchAll(/Escribí menos de 200 caracteres/g)]).toHaveLength(1);
    expect(/<label[^>]*>(.*?)<\/label>/.exec(html)?.[1]).toBe("Observaciones");
  });

  it("required: asterisco decorativo y el atributo en el <textarea>; etiquetaOculta: solo para lectores (sr-only)", () => {
    const html = renderToStaticMarkup(<AreaDeTexto etiqueta="Nota" required />);
    expect(html).toContain('<span aria-hidden="true"> *</span>');
    expect(html).toMatch(/<textarea[^>]*\srequired(=""|\s|>)/);
    const oculta = renderToStaticMarkup(<AreaDeTexto etiqueta="Nota" etiquetaOculta />);
    expect(clasesDe(oculta, "label")).toEqual(["sr-only"]);
    expect(oculta).toContain(">Nota</label>");
  });

  it("clases de tokens (borde de control, o de error), piso de 44 px en celular; nunca sm:, modo oscuro ni colores de escala", () => {
    const sinError = clasesDe(renderToStaticMarkup(<AreaDeTexto etiqueta="x" />), "textarea");
    for (const clase of ["border-borde-control", "bg-superficie", "text-tinta", "focus-visible:outline-foco", "disabled:bg-superficie-suave", "disabled:text-tinta-tenue", "min-h-11", "md:min-h-9", "text-base", "md:text-sm", "resize-y"]) {
      expect(sinError, clase).toContain(clase);
    }
    expect(sinError.filter((c) => /^min-h-/.test(c))).toEqual(["min-h-11"]);
    expect(clasesDe(renderToStaticMarkup(<AreaDeTexto etiqueta="x" tamano="compacto" />), "textarea")).toContain("md:min-h-8");
    const conError = clasesDe(renderToStaticMarkup(<AreaDeTexto etiqueta="x" error="mal" />), "textarea");
    expect(conError).toContain("border-error");
    expect(conError).not.toContain("border-borde-control");
    const html = renderToStaticMarkup(<AreaDeTexto etiqueta="x" ayuda="a" error="e" />);
    expect(html).not.toMatch(/(^|[\s":])dark:/);
    expect(html).not.toMatch(/(^|[\s":])sm:/);
    expect(html).not.toMatch(/(^|[\s":-])(?:neutral|gray|slate|zinc|stone|red|white|black)-\d/);
  });

  it("className se suma al final sin quitar las clases del sistema", () => {
    const clases = clasesDe(renderToStaticMarkup(<AreaDeTexto etiqueta="x" className="font-mono" />), "textarea");
    expect(clases[clases.length - 1]).toBe("font-mono");
    expect(clases).toContain("min-h-11");
  });

  it("acepta ref (React 19: una prop más) y la deja en el <textarea>", () => {
    const ref = createRef<HTMLTextAreaElement>();
    const envoltura = AreaDeTexto({ etiqueta: "x", ref }) as ReactElement<{
      children: (c: { id: string; "aria-describedby": undefined; "aria-invalid": undefined; className: string }) => ReactElement;
    }>;
    const area = envoltura.props.children({ id: "i", "aria-describedby": undefined, "aria-invalid": undefined, className: "" });
    expect(area.type).toBe("textarea");
    expect((area.props as { ref: unknown }).ref).toBe(ref);
  });
});
