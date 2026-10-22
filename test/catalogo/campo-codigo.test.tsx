import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CampoCodigo } from "../../src/components/campo-codigo";

/**
 * Contrato de `CampoCodigo` (src/components/campo-codigo.tsx): un código de dígitos (CUIT, código de ingreso) es TEXTO con teclado numérico, con su longitud y su `autoComplete` declarados, que no se parsea
 * a número (los ceros a la izquierda y los guiones llegan tal cual). Entorno de Vitest = Node: se mira el HTML del servidor.
 */
const entrada = (html: string): string => /<input[^>]*>/.exec(html)?.[0] ?? "";

describe("CampoCodigo", () => {
  it("es un campo de texto con teclado numérico, con la longitud, el autoComplete y el patrón que declara quien lo usa", () => {
    const html = entrada(renderToStaticMarkup(<CampoCodigo aria-label="Código" autoComplete="one-time-code" longitudMaxima={7} patron="[0-9]*" />));
    expect(html).toContain('type="text"');
    expect(html).toContain('inputMode="numeric"');
    expect(html).toContain('autoComplete="one-time-code"');
    expect(html).toContain('maxLength="7"');
    expect(html).toContain('pattern="[0-9]*"');
    expect(html).not.toContain('type="number"');
  });

  it("conserva el texto tal cual: ceros a la izquierda y guiones de un CUIT, sin darle formato de número", () => {
    expect(entrada(renderToStaticMarkup(<CampoCodigo aria-label="Código" autoComplete="off" longitudMaxima={7} value="0012" onChange={() => {}} />))).toContain('value="0012"');
    expect(entrada(renderToStaticMarkup(<CampoCodigo aria-label="CUIT" autoComplete="off" longitudMaxima={13} value="30-12345678-1" onChange={() => {}} />))).toContain('value="30-12345678-1"');
  });

  it("sin patrón no dibuja el atributo, y la etiqueta se dibuja como en cualquier Campo", () => {
    const html = renderToStaticMarkup(<CampoCodigo etiqueta="CUIT de la empresa" name="cuit" autoComplete="off" longitudMaxima={13} />);
    expect(entrada(html)).not.toContain("pattern=");
    expect(html).toContain("CUIT de la empresa</label>");
  });
});
