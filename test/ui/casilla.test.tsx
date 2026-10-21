import type { ReactElement } from "react";
import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Casilla } from "../../src/ui/primitivas/casilla";

/**
 * Contrato de `Casilla` (src/ui/primitivas/casilla.tsx, contrato `primitiva-casilla`): la casilla de verificación con etiqueta obligatoria y atada con `htmlFor`, ayuda y error conectados con
 * `aria-describedby`, el error UNA sola vez con `role="alert"`, la fila de 44 px en celular, solo tokens, sin modo oscuro y `ref` hasta el `<input>`. Entorno de Vitest = Node: se mira el HTML
 * del servidor.
 */
const clasesDe = (html: string, etiqueta: string): string[] => (new RegExp(`<${etiqueta}[^>]*class="([^"]*)"`).exec(html)?.[1] ?? "").split(/\s+/).filter(Boolean);

describe("Casilla", () => {
  it("es un checkbox con la etiqueta atada por htmlFor/id y deja pasar sus atributos", () => {
    const html = renderToStaticMarkup(<Casilla etiqueta="Es un combo" name="combo" value="si" defaultChecked />);
    const para = /<label for="([^"]+)"/.exec(html)?.[1];
    expect(para).toBeTruthy();
    expect(html).toMatch(new RegExp(`<input[^>]* id="${para}"`));
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('name="combo"');
    expect(html).toContain('value="si"');
    expect(html).toMatch(/<input[^>]*\schecked(=""|\s|>)/);
    expect(/<label[^>]*>(.*?)<\/label>/.exec(html)?.[1]).toBe("Es un combo");
    expect(html).not.toContain("aria-invalid");
    expect(html).not.toContain("aria-describedby");
  });

  it("el tipo no se puede cambiar desde afuera: siempre es checkbox", () => {
    // @ts-expect-error `type` no es una prop de Casilla: si compilara, el tipo no estaría protegiendo nada.
    const html = renderToStaticMarkup(<Casilla etiqueta="x" type="radio" />);
    expect(html).toContain('type="checkbox"');
    expect(html).not.toContain('type="radio"');
  });

  it("la etiqueta es OBLIGATORIA: omitirla no compila", () => {
    // @ts-expect-error falta `etiqueta`: si compilara, el tipo no estaría protegiendo nada.
    const elemento: ReactElement = <Casilla name="sin-etiqueta" />;
    expect(elemento.type).toBe(Casilla);
  });

  it("dos casillas en la misma pantalla no comparten id; un id explícito manda", () => {
    const dos = renderToStaticMarkup(
      <>
        <Casilla etiqueta="A" />
        <Casilla etiqueta="B" />
      </>,
    );
    const ids = [...dos.matchAll(/<input[^>]* id="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(2);
    expect(renderToStaticMarkup(<Casilla etiqueta="A" id="casilla-a" />)).toContain('<label for="casilla-a"');
  });

  it("con ayuda y error: aria-describedby los apunta, aria-invalid, y el error aparece UNA sola vez con role=alert, fuera de la etiqueta", () => {
    const html = renderToStaticMarkup(<Casilla etiqueta="Acepto" ayuda="Se puede cambiar después" error="Tenés que aceptar para seguir" />);
    expect(html).toContain('aria-invalid="true"');
    const ids = (/aria-describedby="([^"]+)"/.exec(html)?.[1] ?? "").split(" ");
    expect(ids).toHaveLength(2);
    for (const id of ids) expect(html, id).toContain(`<p id="${id}"`);
    expect([...html.matchAll(/role="alert"/g)]).toHaveLength(1);
    expect([...html.matchAll(/Tenés que aceptar para seguir/g)]).toHaveLength(1);
    expect(/<label[^>]*>(.*?)<\/label>/.exec(html)?.[1]).toBe("Acepto");
  });

  it("solo con ayuda: se describe con la ayuda, sin aria-invalid ni alerta", () => {
    const html = renderToStaticMarkup(<Casilla etiqueta="Acepto" ayuda="Se puede cambiar después" />);
    expect(idsDeDescripcion(html)).toHaveLength(1);
    expect(html).not.toContain("aria-invalid");
    expect(html).not.toContain('role="alert"');
  });

  it("clases de tokens (borde de control, o de error), fila y etiqueta con piso de 44 px en celular; nunca sm:, modo oscuro ni colores de escala", () => {
    const html = renderToStaticMarkup(<Casilla etiqueta="x" />);
    const casilla = clasesDe(html, "input");
    for (const clase of ["border-borde-control", "bg-superficie", "text-tinta", "focus-visible:outline-foco", "disabled:bg-superficie-suave"]) expect(casilla, clase).toContain(clase);
    const etiqueta = clasesDe(html, "label");
    for (const clase of ["text-tinta", "min-h-11", "md:min-h-9", "peer-disabled:text-tinta-tenue"]) expect(etiqueta, clase).toContain(clase);
    expect(html).toContain('<div class="flex min-h-11 items-center gap-2 md:min-h-9">');
    const conError = clasesDe(renderToStaticMarkup(<Casilla etiqueta="x" error="mal" />), "input");
    expect(conError).toContain("border-error");
    expect(conError).not.toContain("border-borde-control");
    const completo = renderToStaticMarkup(<Casilla etiqueta="x" ayuda="a" error="e" />);
    expect(completo).not.toMatch(/(^|[\s":])dark:/);
    expect(completo).not.toMatch(/(^|[\s":])sm:/);
    expect(completo).not.toMatch(/(^|[\s":-])(?:neutral|gray|slate|zinc|stone|red|white|black)-\d/);
  });

  it("className se suma al final sin quitar las clases del sistema", () => {
    const clases = clasesDe(renderToStaticMarkup(<Casilla etiqueta="x" className="ml-2" />), "input");
    expect(clases[clases.length - 1]).toBe("ml-2");
    expect(clases).toContain("border-borde-control");
  });

  it("acepta ref (React 19: una prop más) y la deja en el <input>", () => {
    const ref = createRef<HTMLInputElement>();
    // `Casilla` usa `useId`: se llama DENTRO del render de otro componente para quedarse con el árbol de elementos que devuelve.
    let raiz: ReactElement<{ children: ReactElement[] }> | undefined;
    const Sonda = () => {
      raiz = Casilla({ etiqueta: "x", ref }) as ReactElement<{ children: ReactElement[] }>;
      return null;
    };
    renderToStaticMarkup(<Sonda />);
    const fila = raiz!.props.children[0] as ReactElement<{ children: ReactElement[] }>;
    const input = fila.props.children[0];
    expect(input.type).toBe("input");
    expect((input.props as { ref: unknown }).ref).toBe(ref);
  });
});

/** Los ids de `aria-describedby` de un HTML. */
function idsDeDescripcion(html: string): string[] {
  return (/aria-describedby="([^"]+)"/.exec(html)?.[1] ?? "").split(" ").filter(Boolean);
}
