import type { ReactElement } from "react";
import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Aviso, type FormaDeAviso, type VarianteDeAviso } from "../../src/ui/primitivas/aviso";

/**
 * Contrato de `Aviso` (src/ui/primitivas/aviso.tsx, contrato `primitiva-aviso`): la variante (éxito, advertencia, error, información) decide el tono Y el rol (el error es `role="alert"`, el resto
 * `role="status"`), la forma (caja o en línea) decide cómo se ve, solo tokens, sin modo oscuro y `ref` hasta el `<div>`. Entorno de Vitest = Node: se mira el HTML del servidor.
 */
const clasesDe = (html: string): string[] => (/<div[^>]*class="([^"]*)"/.exec(html)?.[1] ?? "").split(/\s+/).filter(Boolean);
const rolDe = (html: string): string | undefined => /<div[^>]*\srole="([^"]*)"/.exec(html)?.[1];
const dibujar = (variante: VarianteDeAviso, forma?: FormaDeAviso, extra: { className?: string } = {}): string =>
  renderToStaticMarkup(
    <Aviso variante={variante} forma={forma} {...extra}>
      Se guardó
    </Aviso>,
  );

const VARIANTES: readonly VarianteDeAviso[] = ["exito", "advertencia", "error", "informacion"];
const FORMAS: readonly FormaDeAviso[] = ["en-linea", "caja"];

/** [variante, clases de la caja, clase de texto en línea]. */
const TONOS: readonly (readonly [VarianteDeAviso, readonly string[], string])[] = [
  ["exito", ["border-ok", "bg-ok-tinte", "text-ok-tinta"], "text-ok-tinta"],
  ["advertencia", ["border-aviso", "bg-aviso-tinte", "text-aviso-tinta"], "text-aviso-tinta"],
  ["error", ["border-error", "bg-error-tinte", "text-error"], "text-error"],
  ["informacion", ["border-borde", "bg-superficie-suave", "text-tinta-suave"], "text-tinta-suave"],
];

describe("Aviso", () => {
  it("el rol sale de la variante: el error es alert y las demás son status, en las dos formas", () => {
    for (const forma of FORMAS) {
      expect(rolDe(dibujar("error", forma)), `error ${forma}`).toBe("alert");
      for (const variante of ["exito", "advertencia", "informacion"] as const) expect(rolDe(dibujar(variante, forma)), `${variante} ${forma}`).toBe("status");
    }
  });

  it("quien lo usa no puede poner el rol: el tipo se lo impide, y el rol de la variante manda", () => {
    // @ts-expect-error `role` no es una prop de Aviso: si compilara, un error podría quedar como status.
    const html = renderToStaticMarkup(<Aviso variante="error" role="status">Mal</Aviso>);
    expect(rolDe(html)).toBe("alert");
  });

  it("la variante es OBLIGATORIA: omitirla no compila", () => {
    // @ts-expect-error falta `variante`: si compilara, el tipo no estaría protegiendo nada.
    const elemento: ReactElement = <Aviso>Hola</Aviso>;
    expect(elemento.type).toBe(Aviso);
  });

  it.each(TONOS)("%s en caja: borde, fondo tintado y texto del tono (todo tokens)", (variante, clases) => {
    const c = clasesDe(dibujar(variante, "caja"));
    for (const clase of [...clases, "rounded", "border", "px-3", "py-2", "text-sm"]) expect(c, `${variante}: ${clase}`).toContain(clase);
  });

  it.each(TONOS)("%s en línea: solo el color del texto, sin recuadro", (variante, _caja, texto) => {
    const c = clasesDe(dibujar(variante, "en-linea"));
    expect(c).toEqual(["text-sm", texto]);
  });

  it("la forma por defecto es la caja", () => {
    expect(dibujar("exito")).toBe(dibujar("exito", "caja"));
  });

  it("deja pasar el contenido y los atributos de un <div> (id, aria-*, data-*)", () => {
    const html = renderToStaticMarkup(
      <Aviso variante="informacion" id="aviso-1" data-prueba="x" aria-label="Estado">
        <strong>Ojo</strong> con esto
      </Aviso>,
    );
    expect(html).toContain('id="aviso-1"');
    expect(html).toContain('data-prueba="x"');
    expect(html).toContain('aria-label="Estado"');
    expect(html).toContain("<strong>Ojo</strong> con esto</div>");
  });

  it("className se suma al final sin quitar las clases del sistema", () => {
    const c = clasesDe(dibujar("error", "caja", { className: "mt-2" }));
    expect(c[c.length - 1]).toBe("mt-2");
    expect(c).toContain("bg-error-tinte");
  });

  it("nunca trae sm:, modo oscuro ni colores de escala, en ninguna variante ni forma", () => {
    for (const variante of VARIANTES) {
      for (const forma of FORMAS) {
        const html = dibujar(variante, forma);
        expect(html, `${variante} ${forma}`).not.toMatch(/(^|[\s":])dark:/);
        expect(html, `${variante} ${forma}`).not.toMatch(/(^|[\s":])sm:/);
        expect(html, `${variante} ${forma}`).not.toMatch(/(^|[\s":-])(?:neutral|gray|slate|zinc|stone|red|green|amber|yellow|blue|white|black)-\d/);
      }
    }
  });

  it("acepta ref (React 19: una prop más) y la deja en el <div>", () => {
    const ref = createRef<HTMLDivElement>();
    const aviso = Aviso({ variante: "exito", ref, children: "ok" }) as ReactElement;
    expect(aviso.type).toBe("div");
    expect((aviso.props as { ref: unknown }).ref).toBe(ref);
  });
});
