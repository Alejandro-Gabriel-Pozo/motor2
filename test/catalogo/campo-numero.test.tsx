import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MARCA_DE_NO_CANONICO } from "../../src/core/datos/numero-tecleado";
import { CampoNumero } from "../../src/components/campo-numero";

/**
 * `CampoNumero` (src/components/campo-numero.tsx) dibuja la primitiva `Campo` (6.8.7c). Lo que se prueba acá es lo que el componente le pide a la primitiva y lo que sale al HTML: el nombre accesible
 * (`ariaLabel` o el `<label>` de afuera, nunca uno propio), el campo marcado como inválido con el mensaje de lo que no se entiende debajo, el `<input type="hidden">` del modo no controlado ANTES del visible, el prefijo, la alineación
 * a la derecha y que `etiqueta` (el sujeto del mensaje de error) no se dibuja como rótulo. La lógica del número (interpretar, formatear, validar, seleccionar al enfocar) se prueba en
 * `test/core/datos` y en el navegador (test/e2e/campo-numero-tactil.spec.ts). Entorno de Vitest = Node: se mira el HTML del servidor.
 */
const entradaVisible = (html: string): string => /<input[^>]*type="text"[^>]*>/.exec(html)?.[0] ?? "";
const clasesDe = (etiqueta: string): string[] => (/class="([^"]*)"/.exec(etiqueta)?.[1] ?? "").split(/\s+/).filter(Boolean);

describe("CampoNumero dibuja la primitiva Campo", () => {
  it("un texto que no es un número deja el campo aria-invalid y con borde de error, y DICE por qué debajo (role=alert, atado con aria-describedby)", () => {
    const html = renderToStaticMarkup(<CampoNumero value="12abc" tipo="importe" etiqueta="El precio" ariaLabel="Precio" />);
    const entrada = entradaVisible(html);
    expect(entrada).toContain('aria-invalid="true"');
    expect(clasesDe(entrada)).toContain("border-error");
    expect(html.match(/role="alert"/g)).toHaveLength(1);
    expect(html).toContain("El precio no es un número válido.");
    expect(entrada).toContain("aria-describedby=");
  });

  // regla de números 2026-11-09: ya no existe el «ambiguo» ni el punto de miles. Un «.» en lo que quedó en el campo (un valor que llegó por afuera, marcado como lo deja el campo) es siempre el aviso de la coma.
  it("«1.205» en un campo de kilos (marcado como lo deja el campo) lleva un punto: dice que los decimales van con coma, en cualquier cantidad de decimales; la marca no se ve", () => {
    for (const decimales of [3, 2, 0]) {
      const html = renderToStaticMarkup(<CampoNumero value={`1.205${MARCA_DE_NO_CANONICO}`} tipo="cantidad" decimales={decimales} ariaLabel="Kilos" />);
      expect(html, `${decimales} decimales`).toContain("La cantidad: Los decimales van con coma: 0,5");
      expect(entradaVisible(html)).toContain('aria-invalid="true"');
      expect(html).not.toContain("¿1,205 o 1205?");
      expect(entradaVisible(html)).not.toContain(MARCA_DE_NO_CANONICO);
    }
  });

  it("lo que emite un campo para 1205 se ve con punto de miles («1.205» en cantidad, «1.205,00» en un importe) y sin error", () => {
    const g = renderToStaticMarkup(<CampoNumero value="1205" tipo="cantidad" decimales={0} ariaLabel="Gramos" />);
    const importe = renderToStaticMarkup(<CampoNumero value="1205" tipo="importe" etiqueta="El precio" ariaLabel="Precio" />);
    for (const html of [g, importe]) expect(html).not.toContain('role="alert"');
    expect(entradaVisible(g)).toContain('value="1.205"');
    expect(entradaVisible(importe)).toContain('value="1.205,00"'); // el importe siempre con 2 decimales
  });

  it("«21,000» en un importe dice que admite 2 decimales y cómo escribir veintiún mil (sin ofrecer el punto)", () => {
    const html = renderToStaticMarkup(<CampoNumero value="21,000" tipo="importe" etiqueta="El precio" ariaLabel="Precio" />);
    expect(html).toContain("El precio admite como máximo 2 decimales. Para 21000 escribí 21000.");
    expect(html).not.toContain("21.000,00");
  });

  it("un valor del canal que no cumple la regla (negativo en un importe) marca el campo pero no dibuja mensaje: lo frena la validez nativa y lo dice el servidor", () => {
    const html = renderToStaticMarkup(<CampoNumero value="-5" tipo="importe" etiqueta="El precio" ariaLabel="Precio" />);
    expect(entradaVisible(html)).toContain('aria-invalid="true"');
    expect(html).not.toContain('role="alert"');
  });

  it("un valor válido o vacío no lo marca", () => {
    for (const value of ["1234.5", ""]) {
      const entrada = entradaVisible(renderToStaticMarkup(<CampoNumero value={value} tipo="importe" ariaLabel="Precio" />));
      expect(entrada, `«${value}»`).not.toContain("aria-invalid");
      expect(clasesDe(entrada), `«${value}»`).toContain("border-borde-control");
    }
  });

  it("el <input type=\"hidden\"> del modo no controlado va ANTES del campo visible y lleva el valor real; sin name no hay hidden", () => {
    const html = renderToStaticMarkup(<CampoNumero tipo="cantidad" name="cantidad" defaultValue="1234.5" ariaLabel="Cantidad" />);
    const oculto = html.indexOf('type="hidden"');
    const visible = html.indexOf('type="text"');
    expect(oculto).toBeGreaterThanOrEqual(0);
    expect(oculto).toBeLessThan(visible);
    expect(html).toMatch(/<input[^>]*type="hidden"[^>]*name="cantidad"[^>]*value="1234.5"|<input[^>]*name="cantidad"[^>]*type="hidden"[^>]*value="1234.5"/);
    expect([...html.matchAll(/type="hidden"/g)]).toHaveLength(1);
    expect(renderToStaticMarkup(<CampoNumero tipo="cantidad" value="1" ariaLabel="Cantidad" />)).not.toContain('type="hidden"');
  });

  it("dentro de un <label> hay UN solo <label>: la primitiva no dibuja el suyo (quedaría anidado)", () => {
    const html = renderToStaticMarkup(
      <label>
        Cantidad
        <CampoNumero tipo="cantidad" value="2" />
      </label>,
    );
    expect([...html.matchAll(/<label/g)]).toHaveLength(1);
    expect(html).not.toContain("aria-label");
    expect(html).not.toMatch(/nombrado/i);
  });

  it("ariaLabel va al input y no se dibuja <label>; sin ariaLabel no hay aria-label", () => {
    const con = renderToStaticMarkup(<CampoNumero tipo="cantidad" value="2" ariaLabel="Cantidad" />);
    expect(entradaVisible(con)).toContain('aria-label="Cantidad"');
    expect(con).not.toContain("<label");
    expect(renderToStaticMarkup(<CampoNumero tipo="cantidad" value="2" />)).not.toContain("aria-label");
  });

  it("`etiqueta` es el sujeto del mensaje de error, NO el rótulo: con un valor válido no aparece en el HTML, y con uno inválido solo dentro del mensaje", () => {
    expect(renderToStaticMarkup(<CampoNumero value="10" tipo="importe" etiqueta="El precio" ariaLabel="Precio" />)).not.toContain("El precio");
    const html = renderToStaticMarkup(<CampoNumero value="abc" tipo="importe" etiqueta="El precio" ariaLabel="Precio" />);
    expect(html.replace(/<p [^>]*role="alert"[^>]*>[^<]*<\/p>/, "")).not.toContain("El precio");
    expect(html).not.toContain("<label");
  });

  it("el prefijo «$» va antes del input, sin aria-hidden, y el input deja lugar (pl-5); sin prefijo no hay ni símbolo ni relleno", () => {
    const html = renderToStaticMarkup(<CampoNumero tipo="importe" value="10" prefijo="$" ariaLabel="Precio" />);
    expect(html).toMatch(/<span class="[^"]*text-tinta-suave[^"]*">\$<\/span><input /);
    expect(html).not.toContain("aria-hidden");
    expect(clasesDe(entradaVisible(html))).toContain("pl-5");
    const sin = renderToStaticMarkup(<CampoNumero tipo="cantidad" value="10" ariaLabel="Precio" />);
    expect(sin).not.toContain("<span");
    expect(clasesDe(entradaVisible(sin))).not.toContain("pl-5");
  });

  it("el número va siempre alineado a la derecha, con y sin prefijo, en los dos tamaños", () => {
    for (const tamano of ["normal", "compacto"] as const) {
      for (const prefijo of [undefined, "$"]) {
        expect(clasesDe(entradaVisible(renderToStaticMarkup(<CampoNumero tipo="importe" value="1" tamano={tamano} prefijo={prefijo} ariaLabel="n" />))), `${tamano} ${prefijo}`).toContain("text-right");
      }
    }
  });

  it("conserva el tipo de campo: texto con teclado decimal, sin autocompletar, y placeholder, required, id y autoFocus llegan al input", () => {
    const entrada = entradaVisible(renderToStaticMarkup(<CampoNumero tipo="cantidad" id="precio-x" value="" placeholder="Precio" required autoFocus ariaLabel="Precio" />));
    expect(entrada).toContain('type="text"');
    expect(entrada).toContain('inputMode="decimal"');
    expect(entrada).toContain('autoComplete="off"');
    expect(entrada).toContain('id="precio-x"');
    expect(entrada).toContain('placeholder="Precio"');
    expect(entrada).toMatch(/\srequired(=""|\s|>)/);
  });

  it("el tamaño compacto usa la altura compacta de Campo (44 px en celular y la compacta desde md:); el normal, la normal", () => {
    expect(clasesDe(entradaVisible(renderToStaticMarkup(<CampoNumero tipo="cantidad" value="1" tamano="compacto" ariaLabel="n" />)))).toEqual(expect.arrayContaining(["min-h-11", "md:min-h-8"]));
    expect(clasesDe(entradaVisible(renderToStaticMarkup(<CampoNumero tipo="cantidad" value="1" ariaLabel="n" />)))).toEqual(expect.arrayContaining(["min-h-11", "md:min-h-9"]));
  });

  // regla de números 2026-11-09: el contenedor vuelve a ser `relative` (ancla el «= …» y el aviso del punto, que son `absolute`); el prefijo lo sigue ubicando Campo.
  it("className va al contenedor (no al input), junto a `relative` (ancla el aviso y el «= …»); sin className queda solo `relative`, sin un class vacío", () => {
    const con = renderToStaticMarkup(<CampoNumero tipo="cantidad" value="1" className="w-28" ariaLabel="n" />);
    expect(con.startsWith('<div class="relative w-28">')).toBe(true);
    expect(clasesDe(entradaVisible(con))).not.toContain("w-28");
    const sin = renderToStaticMarkup(<CampoNumero tipo="cantidad" value="1" ariaLabel="n" />);
    expect(sin.startsWith('<div class="relative">')).toBe(true);
    expect(sin).not.toContain('class=""');
  });
});
