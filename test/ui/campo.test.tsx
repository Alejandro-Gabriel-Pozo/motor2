import type { ReactElement } from "react";
import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Campo, EnvolturaDeCampo, type AtributosDeControl, type TamanoDeCampo } from "../../src/ui/primitivas/campo";

/**
 * Contrato de `EnvolturaDeCampo` y `Campo` (src/ui/primitivas/campo.tsx, contrato `primitiva-campo`): etiqueta atada, ayuda, lectura y error conectados con `aria-describedby`, el error UNA sola
 * vez y fuera de la etiqueta, la etiqueta oculta solo para lectores, el tamaño compacto desde `md:`, solo tokens, sin modo oscuro y `ref` hasta el `<input>`. Entorno de Vitest = Node: se mira
 * el HTML del servidor.
 */
const clasesDe = (html: string, etiqueta: string): string[] => (new RegExp(`<${etiqueta}[^>]*class="([^"]*)"`).exec(html)?.[1] ?? "").split(/\s+/).filter(Boolean);
const idsDe = (atributo: string): string[] => atributo.split(" ").filter(Boolean);

describe("EnvolturaDeCampo", () => {
  const dibujar = (props: { etiqueta?: string; etiquetaOculta?: boolean; requerido?: boolean; ayuda?: string; lectura?: string; error?: string; id?: string } = {}): string =>
    renderToStaticMarkup(
      <EnvolturaDeCampo etiqueta="Nombre" {...props}>
        {(control: AtributosDeControl) => <input {...control} name="nombre" />}
      </EnvolturaDeCampo>,
    );

  it("la etiqueta está atada al control por htmlFor/id, y sin ayuda, lectura ni error no hay descripción ni aria-invalid", () => {
    const html = dibujar();
    const para = /<label for="([^"]+)"/.exec(html)?.[1];
    expect(para).toBeTruthy();
    expect(html).toContain(`<input id="${para}"`);
    expect(html).not.toContain("aria-invalid");
    expect(html).not.toContain("aria-describedby");
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain("aria-live");
  });

  it("un id explícito manda sobre el generado; dos envolturas sin id no comparten id", () => {
    expect(dibujar({ id: "campo-precio" })).toContain('<label for="campo-precio"');
    const dos = renderToStaticMarkup(
      <>
        <EnvolturaDeCampo etiqueta="A">{(c) => <input {...c} />}</EnvolturaDeCampo>
        <EnvolturaDeCampo etiqueta="B">{(c) => <input {...c} />}</EnvolturaDeCampo>
      </>,
    );
    const ids = [...dos.matchAll(/<input id="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(2);
  });

  it("la ayuda, la lectura y el error se anuncian con aria-describedby, en ese orden, y cada id existe en el HTML", () => {
    const html = dibujar({ ayuda: "En pesos", lectura: "En la carta se verá: De carne", error: "Ingresá un número mayor a 0" });
    const ids = idsDe(/aria-describedby="([^"]+)"/.exec(html)?.[1] ?? "");
    expect(ids.map((i) => i.split("-").pop())).toEqual(["ayuda", "lectura", "error"]);
    for (const id of ids) expect(html, id).toContain(`<p id="${id}"`);
    expect(html).toContain('aria-live="polite"');
  });

  it("el error aparece UNA sola vez, con role=alert, y el control queda aria-invalid", () => {
    const html = dibujar({ error: "Ingresá un número mayor a 0" });
    expect(html).toContain('aria-invalid="true"');
    expect([...html.matchAll(/role="alert"/g)]).toHaveLength(1);
    expect([...html.matchAll(/Ingresá un número mayor a 0/g)]).toHaveLength(1);
  });

  it("la ayuda, la lectura y el error van FUERA del label (si no, el lector de pantalla los lee como parte del nombre)", () => {
    const html = dibujar({ ayuda: "Texto de ayuda", lectura: "Texto de lectura", error: "Texto de error" });
    const label = /<label[^>]*>(.*?)<\/label>/.exec(html)?.[1] ?? "";
    expect(label).toBe("Nombre");
    for (const texto of ["Texto de ayuda", "Texto de lectura", "Texto de error"]) expect(html).toContain(texto);
  });

  it("etiquetaOculta: la etiqueta existe y atada pero solo para lectores de pantalla (sr-only); sin ella, se ve", () => {
    expect(clasesDe(dibujar({ etiquetaOculta: true }), "label")).toEqual(["sr-only"]);
    expect(dibujar({ etiquetaOculta: true })).toContain(">Nombre</label>");
    expect(clasesDe(dibujar(), "label")).toContain("font-medium");
    expect(clasesDe(dibujar(), "label")).not.toContain("sr-only");
  });

  it("requerido marca un asterisco decorativo (aria-hidden) y no lo repite en el nombre", () => {
    const html = dibujar({ requerido: true });
    expect(html).toContain('<span aria-hidden="true"> *</span>');
    expect(dibujar()).not.toContain("aria-hidden");
  });

  it("el aspecto del control es de tokens: borde de control, o de error si hay error; nunca colores de escala ni modo oscuro", () => {
    const sinError = (/<input[^>]*class="([^"]*)"/.exec(dibujar())?.[1] ?? "").split(/\s+/);
    const conError = (/<input[^>]*class="([^"]*)"/.exec(dibujar({ error: "mal" }))?.[1] ?? "").split(/\s+/);
    for (const clase of ["border-borde-control", "bg-superficie", "text-tinta", "focus-visible:outline-foco", "disabled:bg-superficie-suave", "disabled:text-tinta-tenue", "text-base", "md:text-sm"]) {
      expect(sinError, clase).toContain(clase);
    }
    expect(sinError).not.toContain("border-error");
    expect(conError).toContain("border-error");
    expect(conError).not.toContain("border-borde-control");
  });

  it("la ayuda y el error usan los tokens de tinta suave y de error", () => {
    const html = dibujar({ ayuda: "ayuda", error: "error" });
    const claseDelParrafo = (sufijo: string): string[] => (new RegExp(`<p id="[^"]*-${sufijo}"[^>]*class="([^"]*)"`).exec(html)?.[1] ?? "").split(/\s+/);
    expect(claseDelParrafo("ayuda")).toContain("text-tinta-suave");
    expect(claseDelParrafo("error")).toContain("text-error");
  });
});

describe("Campo", () => {
  it("dibuja un input con su etiqueta atada y deja pasar los atributos del input", () => {
    const html = renderToStaticMarkup(<Campo etiqueta="CUIT" name="cuit" maxLength={11} placeholder="Sin guiones" />);
    const id = /<label for="([^"]+)"/.exec(html)?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`id="${id}"`);
    expect(html).toContain('name="cuit"');
    expect(html).toContain('maxLength="11"');
    expect(html).toContain('placeholder="Sin guiones"');
  });

  it("con error: aria-invalid, UN solo mensaje con role=alert y una descripción que apunta al mensaje; con ayuda también a la ayuda", () => {
    const html = renderToStaticMarkup(<Campo etiqueta="Precio" ayuda="En pesos" error="Ingresá un número mayor a 0" />);
    expect(html).toContain('aria-invalid="true"');
    expect([...html.matchAll(/role="alert"/g)]).toHaveLength(1);
    const ids = idsDe(/aria-describedby="([^"]+)"/.exec(html)?.[1] ?? "");
    expect(ids).toHaveLength(2);
    expect(html).toContain(`<p id="${ids.find((i) => i.endsWith("-error"))}" role="alert"`);
  });

  it("required: asterisco decorativo y el atributo en el input", () => {
    const html = renderToStaticMarkup(<Campo etiqueta="Nombre" required />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toMatch(/<input[^>]*\srequired(=""|\s|>)/);
  });

  it("tamaño normal por defecto y compacto desde md:, ambos con 44 px en celular; nunca el corte sm:", () => {
    const alturas: Record<TamanoDeCampo, string> = { normal: "md:min-h-9", compacto: "md:min-h-8" };
    for (const tamano of ["normal", "compacto"] as const) {
      const input = clasesDe(renderToStaticMarkup(<Campo etiqueta="x" tamano={tamano} />), "input");
      expect(input, tamano).toContain("min-h-11");
      expect(input, tamano).toContain(alturas[tamano]);
      expect(input.filter((c) => /^min-h-/.test(c)), tamano).toEqual(["min-h-11"]);
      expect(input.some((c) => c.startsWith("sm:")), tamano).toBe(false);
    }
    expect(clasesDe(renderToStaticMarkup(<Campo etiqueta="x" />), "input")).toContain("md:min-h-9");
  });

  it("sin modo oscuro ni colores de escala en el HTML que dibuja", () => {
    const html = renderToStaticMarkup(<Campo etiqueta="x" ayuda="a" error="e" />);
    expect(html).not.toMatch(/(^|[\s":])dark:/);
    expect(html).not.toMatch(/(^|[\s":-])(?:neutral|gray|slate|zinc|stone|red|white|black)-\d/);
  });

  it("className se suma al final sin quitar las clases del sistema", () => {
    const input = clasesDe(renderToStaticMarkup(<Campo etiqueta="x" className="w-24" />), "input");
    expect(input[input.length - 1]).toBe("w-24");
    expect(input).toContain("min-h-11");
  });

  it("acepta ref (React 19: una prop más) y la deja en el input", () => {
    const ref = createRef<HTMLInputElement>();
    const envoltura = Campo({ etiqueta: "x", ref }) as ReactElement<{ children: (c: AtributosDeControl) => ReactElement }>;
    const input = envoltura.props.children({ id: "i", "aria-describedby": undefined, "aria-invalid": undefined, className: "" });
    expect(input.type).toBe("input");
    expect((input.props as { ref: unknown }).ref).toBe(ref);
  });
});
