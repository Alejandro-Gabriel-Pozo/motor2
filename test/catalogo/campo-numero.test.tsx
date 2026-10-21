import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CampoNumero } from "../../src/components/campo-numero";

/**
 * `CampoNumero` (src/components/campo-numero.tsx) dibuja la primitiva `Campo` (6.8.7c). Lo que se prueba acá es lo que el componente le pide a la primitiva y lo que sale al HTML: el nombre accesible
 * (`ariaLabel` o el `<label>` de afuera, nunca uno propio), el campo marcado como inválido SIN mensaje, el `<input type="hidden">` del modo no controlado ANTES del visible, el prefijo, la alineación
 * a la derecha y que `etiqueta` (el sujeto del mensaje de error) no se dibuja como rótulo. La lógica del número (interpretar, formatear, validar, seleccionar al enfocar) se prueba en
 * `test/core/datos` y en el navegador (test/e2e/campo-numero-tactil.spec.ts). Entorno de Vitest = Node: se mira el HTML del servidor.
 */
const entradaVisible = (html: string): string => /<input[^>]*type="text"[^>]*>/.exec(html)?.[0] ?? "";
const clasesDe = (etiqueta: string): string[] => (/class="([^"]*)"/.exec(etiqueta)?.[1] ?? "").split(/\s+/).filter(Boolean);

describe("CampoNumero dibuja la primitiva Campo", () => {
  it("un valor inválido deja el campo aria-invalid y con borde de error, SIN role=alert ni mensaje en pantalla ni aria-describedby", () => {
    const html = renderToStaticMarkup(<CampoNumero value="12abc" tipo="importe" etiqueta="El precio" ariaLabel="Precio" />);
    const entrada = entradaVisible(html);
    expect(entrada).toContain('aria-invalid="true"');
    expect(clasesDe(entrada)).toContain("border-error");
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain("aria-describedby");
    expect(html).not.toContain("<p");
  });

  it("un valor válido o vacío no lo marca", () => {
    for (const value of ["1234.5", ""]) {
      const entrada = entradaVisible(renderToStaticMarkup(<CampoNumero value={value} tipo="importe" ariaLabel="Precio" />));
      expect(entrada, `«${value}»`).not.toContain("aria-invalid");
      expect(clasesDe(entrada), `«${value}»`).toContain("border-borde-control");
    }
  });

  it("el <input type=\"hidden\"> del modo no controlado va ANTES del campo visible y lleva el valor real; sin name no hay hidden", () => {
    const html = renderToStaticMarkup(<CampoNumero name="cantidad" defaultValue="1234.5" ariaLabel="Cantidad" />);
    const oculto = html.indexOf('type="hidden"');
    const visible = html.indexOf('type="text"');
    expect(oculto).toBeGreaterThanOrEqual(0);
    expect(oculto).toBeLessThan(visible);
    expect(html).toMatch(/<input[^>]*type="hidden"[^>]*name="cantidad"[^>]*value="1234.5"|<input[^>]*name="cantidad"[^>]*type="hidden"[^>]*value="1234.5"/);
    expect([...html.matchAll(/type="hidden"/g)]).toHaveLength(1);
    expect(renderToStaticMarkup(<CampoNumero value="1" ariaLabel="Cantidad" />)).not.toContain('type="hidden"');
  });

  it("dentro de un <label> hay UN solo <label>: la primitiva no dibuja el suyo (quedaría anidado)", () => {
    const html = renderToStaticMarkup(
      <label>
        Cantidad
        <CampoNumero value="2" />
      </label>,
    );
    expect([...html.matchAll(/<label/g)]).toHaveLength(1);
    expect(html).not.toContain("aria-label");
    expect(html).not.toMatch(/nombrado/i);
  });

  it("ariaLabel va al input y no se dibuja <label>; sin ariaLabel no hay aria-label", () => {
    const con = renderToStaticMarkup(<CampoNumero value="2" ariaLabel="Cantidad" />);
    expect(entradaVisible(con)).toContain('aria-label="Cantidad"');
    expect(con).not.toContain("<label");
    expect(renderToStaticMarkup(<CampoNumero value="2" />)).not.toContain("aria-label");
  });

  it("`etiqueta` es el sujeto del mensaje de error, NO el rótulo: no aparece en el HTML", () => {
    const html = renderToStaticMarkup(<CampoNumero value="abc" tipo="importe" etiqueta="El precio" ariaLabel="Precio" />);
    expect(html).not.toContain("El precio");
    expect(html).not.toContain("<label");
  });

  it("el prefijo «$» va antes del input, sin aria-hidden, y el input deja lugar (pl-5); sin prefijo no hay ni símbolo ni relleno", () => {
    const html = renderToStaticMarkup(<CampoNumero value="10" prefijo="$" ariaLabel="Precio" />);
    expect(html).toMatch(/<span class="[^"]*text-tinta-suave[^"]*">\$<\/span><input /);
    expect(html).not.toContain("aria-hidden");
    expect(clasesDe(entradaVisible(html))).toContain("pl-5");
    const sin = renderToStaticMarkup(<CampoNumero value="10" ariaLabel="Precio" />);
    expect(sin).not.toContain("<span");
    expect(clasesDe(entradaVisible(sin))).not.toContain("pl-5");
  });

  it("el número va siempre alineado a la derecha, con y sin prefijo, en los dos tamaños", () => {
    for (const tamano of ["normal", "compacto"] as const) {
      for (const prefijo of [undefined, "$"]) {
        expect(clasesDe(entradaVisible(renderToStaticMarkup(<CampoNumero value="1" tamano={tamano} prefijo={prefijo} ariaLabel="n" />))), `${tamano} ${prefijo}`).toContain("text-right");
      }
    }
  });

  it("conserva el tipo de campo: texto con teclado decimal, sin autocompletar, y placeholder, required, id y autoFocus llegan al input", () => {
    const entrada = entradaVisible(renderToStaticMarkup(<CampoNumero id="precio-x" value="" placeholder="Precio" required autoFocus ariaLabel="Precio" />));
    expect(entrada).toContain('type="text"');
    expect(entrada).toContain('inputMode="decimal"');
    expect(entrada).toContain('autoComplete="off"');
    expect(entrada).toContain('id="precio-x"');
    expect(entrada).toContain('placeholder="Precio"');
    expect(entrada).toMatch(/\srequired(=""|\s|>)/);
  });

  it("el tamaño compacto usa la altura compacta de Campo (44 px en celular y la compacta desde md:); el normal, la normal", () => {
    expect(clasesDe(entradaVisible(renderToStaticMarkup(<CampoNumero value="1" tamano="compacto" ariaLabel="n" />)))).toEqual(expect.arrayContaining(["min-h-11", "md:min-h-8"]));
    expect(clasesDe(entradaVisible(renderToStaticMarkup(<CampoNumero value="1" ariaLabel="n" />)))).toEqual(expect.arrayContaining(["min-h-11", "md:min-h-9"]));
  });

  it("className va al contenedor (no al input) y el contenedor ya no es `relative` (el prefijo lo ubica Campo); sin className no queda un class vacío", () => {
    const con = renderToStaticMarkup(<CampoNumero value="1" className="w-28" ariaLabel="n" />);
    expect(con.startsWith('<div class="w-28">')).toBe(true);
    expect(clasesDe(entradaVisible(con))).not.toContain("w-28");
    const sin = renderToStaticMarkup(<CampoNumero value="1" ariaLabel="n" />);
    expect(sin.startsWith("<div>")).toBe(true);
    expect(sin).not.toMatch(/<div class="relative/);
  });
});
