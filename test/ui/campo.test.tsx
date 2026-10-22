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

describe("EnvolturaDeCampo: invalido y sin etiqueta", () => {
  const dibujar = (props: { etiqueta?: string; invalido?: boolean; error?: string; ayuda?: string }): string =>
    renderToStaticMarkup(<EnvolturaDeCampo {...props}>{(control: AtributosDeControl) => <input {...control} name="n" />}</EnvolturaDeCampo>);

  it("invalido sin error: el control queda aria-invalid y con borde de error, sin mensaje, sin role=alert y sin aria-describedby", () => {
    const html = dibujar({ etiqueta: "Nombre", invalido: true });
    expect(html).toContain('aria-invalid="true"');
    expect(clasesDe(html, "input")).toContain("border-error");
    expect(clasesDe(html, "input")).not.toContain("border-borde-control");
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain("aria-describedby");
    expect(html).not.toContain("<p");
  });

  it("invalido en falso (o ausente) no marca nada; con error y con invalido a la vez, el mensaje sale UNA vez", () => {
    const sinMarca = dibujar({ etiqueta: "Nombre", invalido: false });
    expect(sinMarca).not.toContain("aria-invalid");
    expect(clasesDe(sinMarca, "input")).toContain("border-borde-control");
    const ambos = dibujar({ etiqueta: "Nombre", invalido: true, error: "Mal" });
    expect([...ambos.matchAll(/role="alert"/g)]).toHaveLength(1);
    expect([...ambos.matchAll(/aria-invalid="true"/g)]).toHaveLength(1);
  });

  it("sin etiqueta no dibuja ningún <label>; el control sigue con su id", () => {
    const html = dibujar({});
    expect(html).not.toContain("<label");
    expect(html).toMatch(/<input id="[^"]+"/);
    expect(dibujar({ etiqueta: "Nombre" })).toContain("<label");
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

describe("Campo: cómo se nombra (NombreDeCampo)", () => {
  it("con etiqueta dibuja el <label> atado (lo de siempre)", () => {
    const html = renderToStaticMarkup(<Campo etiqueta="CUIT" name="cuit" />);
    expect(html).toContain("<label");
    expect(html).not.toContain("aria-label");
  });

  it("con aria-label el input lleva el nombre y NO hay <label>", () => {
    const html = renderToStaticMarkup(<Campo aria-label="Cantidad" name="cantidad" />);
    expect(html).not.toContain("<label");
    expect(html).toMatch(/<input[^>]*\saria-label="Cantidad"/);
  });

  it("con nombradoPorFuera no hay <label> ni el atributo llega al DOM (quien lo nombra es un <label> de afuera)", () => {
    const html = renderToStaticMarkup(
      <label>
        Cantidad
        <Campo nombradoPorFuera name="cantidad" />
      </label>,
    );
    expect([...html.matchAll(/<label/g)]).toHaveLength(1);
    expect(html).not.toMatch(/nombrado|nombrado-por-fuera/i);
    expect(html).toContain('name="cantidad"');
  });

  it("el tipo exige UNA forma de nombre: sin ninguna, o mezclando etiqueta con nombradoPorFuera o con aria-label, no compila", () => {
    // @ts-expect-error falta cómo se nombra: ni etiqueta, ni aria-label, ni nombradoPorFuera.
    const sinNombre: ReactElement = <Campo name="x" />;
    // @ts-expect-error etiqueta y nombradoPorFuera a la vez: dibujaría un <label> y diría que lo pone otro.
    const mezclado: ReactElement = <Campo etiqueta="x" nombradoPorFuera />;
    // @ts-expect-error etiqueta y aria-label a la vez: dos nombres para el mismo control.
    const doble: ReactElement = <Campo etiqueta="x" aria-label="y" />;
    // @ts-expect-error nombradoPorFuera solo admite `true`.
    const apagado: ReactElement = <Campo nombradoPorFuera={false} />;
    for (const e of [sinNombre, mezclado, doble, apagado]) expect(e.type).toBe(Campo);
  });
});

describe("Campo: invalido, alinear y prefijo", () => {
  it("invalido sin error: aria-invalid, borde de error, sin role=alert ni aria-describedby ni mensaje", () => {
    const html = renderToStaticMarkup(<Campo aria-label="Importe" invalido />);
    expect(html).toContain('aria-invalid="true"');
    expect(clasesDe(html, "input")).toContain("border-error");
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain("aria-describedby");
    expect(renderToStaticMarkup(<Campo aria-label="Importe" />)).not.toContain("aria-invalid");
  });

  it("alinear=\"fin\" pone text-right; por defecto (inicio) no", () => {
    expect(clasesDe(renderToStaticMarkup(<Campo aria-label="n" alinear="fin" />), "input")).toContain("text-right");
    expect(clasesDe(renderToStaticMarkup(<Campo aria-label="n" alinear="inicio" />), "input")).not.toContain("text-right");
    expect(clasesDe(renderToStaticMarkup(<Campo aria-label="n" />), "input")).not.toContain("text-right");
  });

  it("prefijo: el símbolo va ANTES del input dentro de un contenedor relative, sin aria-hidden, y el input deja lugar (pl-5)", () => {
    const html = renderToStaticMarkup(<Campo aria-label="Importe" prefijo="$" />);
    expect(html).toMatch(/<div class="relative"><span class="pointer-events-none absolute left-2 top-1\/2 -translate-y-1\/2 text-sm text-tinta-suave">\$<\/span><input /);
    expect(html).not.toContain("aria-hidden");
    expect(clasesDe(html, "input")).toContain("pl-5");
    // Sin prefijo: ni el contenedor ni el relleno.
    const sin = renderToStaticMarkup(<Campo aria-label="Importe" />);
    expect(sin).not.toContain("relative");
    expect(clasesDe(sin, "input")).not.toContain("pl-5");
  });

  it("className sigue al final aunque haya alinear y prefijo, y nada de eso trae modo oscuro ni colores de escala", () => {
    const html = renderToStaticMarkup(<Campo aria-label="n" alinear="fin" prefijo="$" invalido className="w-24" />);
    const input = clasesDe(html, "input");
    expect(input[input.length - 1]).toBe("w-24");
    expect(html).not.toMatch(/(^|[\s":])dark:/);
    expect(html).not.toMatch(/(^|[\s":-])(?:neutral|gray|slate|zinc|stone|red|white|black)-\d/);
  });
});
