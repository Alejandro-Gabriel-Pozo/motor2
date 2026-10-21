import type { ReactElement } from "react";
import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Aviso, type FormaDeAviso, type VarianteDeAviso, type VarianteDeAvisoFlotante } from "../../src/ui/primitivas/aviso";

/**
 * Contrato de `Aviso` (src/ui/primitivas/aviso.tsx, contrato `primitiva-aviso`): la variante (éxito, advertencia, error, información) decide el tono Y el rol (el error es `role="alert"`, el resto
 * `role="status"`), la forma (caja, en línea o flotante) decide cómo se ve, solo tokens, sin modo oscuro y `ref` hasta el `<div>`. Entorno de Vitest = Node: se mira el HTML del servidor.
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

/** La forma flotante (6.8.3b): la barra oscura de «Deshacer». Sin advertencia, que el tipo no deja. */
describe("Aviso forma=flotante", () => {
  const FLOTANTES: readonly VarianteDeAvisoFlotante[] = ["exito", "informacion", "error"];
  const flotante = (variante: VarianteDeAvisoFlotante, extra: { className?: string } = {}): string =>
    renderToStaticMarkup(
      <Aviso variante={variante} forma="flotante" {...extra}>
        Se archivó
      </Aviso>,
    );

  it.each([
    ["exito", "bg-tinta"],
    ["informacion", "bg-tinta"],
    ["error", "bg-error"],
  ] as const)("%s: barra con el fondo %s, texto blanco y sombra, todo tokens y sin recuadro redondeado", (variante, fondo) => {
    const c = clasesDe(flotante(variante));
    for (const clase of ["flex", "items-center", "gap-3", "px-3.5", "py-3", "text-sm", "text-superficie", "shadow-lg", "shadow-sombra", fondo]) expect(c, `${variante}: ${clase}`).toContain(clase);
    expect(c.filter((x) => /^bg-/.test(x)), variante).toEqual([fondo]);
    expect(c.some((x) => /^(rounded|border)/.test(x)), `${variante}: sin recuadro`).toBe(false);
  });

  it("el rol sale de la variante igual que en las otras formas: el error es alert y el resto status", () => {
    expect(rolDe(flotante("error"))).toBe("alert");
    expect(rolDe(flotante("exito"))).toBe("status");
    expect(rolDe(flotante("informacion"))).toBe("status");
  });

  it("la advertencia flotante no compila (el ámbar no llega a 4,5:1 con texto blanco)", () => {
    // @ts-expect-error `advertencia` no es una variante de la forma flotante.
    const elemento: ReactElement = <Aviso variante="advertencia" forma="flotante">Ojo</Aviso>;
    expect(elemento.type).toBe(Aviso);
  });

  it("las demás formas siguen admitiendo la advertencia", () => {
    expect(rolDe(dibujar("advertencia", "caja"))).toBe("status");
    expect(rolDe(dibujar("advertencia", "en-linea"))).toBe("status");
  });

  it("deja pasar los atributos (data-*, id) y className se suma al final", () => {
    const html = renderToStaticMarkup(
      <Aviso variante="exito" forma="flotante" data-aviso-con-deshacer="" id="barra" className="mt-2">
        <span>Listo</span>
      </Aviso>,
    );
    expect(html).toContain('data-aviso-con-deshacer=""');
    expect(html).toContain('id="barra"');
    const c = clasesDe(html);
    expect(c[c.length - 1]).toBe("mt-2");
    expect(c).toContain("bg-tinta");
  });

  it("no se posiciona sola (el envoltorio del consumidor la ubica) y nunca trae sm:, modo oscuro ni colores de escala", () => {
    for (const variante of FLOTANTES) {
      const html = flotante(variante);
      const c = clasesDe(html);
      expect(c.some((x) => /^(fixed|absolute|sticky|top-|bottom-|left-|right-|z-|inset|w-|-translate)/.test(x)), `${variante}: sin ubicación`).toBe(false);
      expect(html, variante).not.toMatch(/(^|[\s":])dark:/);
      expect(html, variante).not.toMatch(/(^|[\s":])sm:/);
      expect(html, variante).not.toMatch(/(^|[\s":-])(?:neutral|gray|slate|zinc|stone|red|green|amber|yellow|blue|white|black)-\d/);
      expect(html, variante).not.toMatch(/\[[^\]]*\]/);
    }
  });
});
