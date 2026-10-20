import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { pieDeLaCartaImpresa, resolverEstiloCarta, type CartaPublicaV1 } from "../../src/core/carta/public";
import { CartaVista } from "../../src/components/carta-publica/carta-vista";

/**
 * Fase 5 de la ola «precio y carta», paso 10 (DEC-20): la carta IMPRESA. Sin navegador: las reglas de `@media print` de `globals.css` (las listas con scroll liberadas, un plato o una tabla sin
 * partirse, los rótulos de una tabla repetidos, la escala en puntos y el pie) y el pie con la fecha de los precios y la dirección pública EN TEXTO (sin QR: decisión del dueño). Lo que se ve en el papel
 * (que nada quede cortado, el pie) lo mira la línea de base de navegador con la impresión emulada (`test/e2e/linea-de-base-precio-y-carta.spec.ts`).
 */

const CSS = readFileSync(join(__dirname, "../../src/app/globals.css"), "utf8");
/** El bloque `@media print { … }` de la carta (el primero: el de la comanda y el ticket es otro). */
const IMPRESION = (() => {
  const inicio = CSS.indexOf("@media print {");
  let profundidad = 0;
  for (let i = CSS.indexOf("{", inicio); i < CSS.length; i++) {
    if (CSS[i] === "{") profundidad++;
    else if (CSS[i] === "}" && --profundidad === 0) return CSS.slice(inicio, i + 1);
  }
  return "";
})();
/** Las declaraciones de la regla con ese selector dentro del bloque de impresión. */
const enPapel = (selector: string) => IMPRESION.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`))?.[1] ?? "";

describe("la carta en papel (@media print)", () => {
  it("las listas con scroll de cada página se liberan: el papel no corta lo que no entraba en la pantalla", () => {
    expect(enPapel(".carta-shell [data-carta-scroll]")).toMatch(/overflow:\s*visible !important/);
    expect(enPapel(".carta-shell [data-carta-scroll]")).toMatch(/height:\s*auto !important/);
    expect(IMPRESION).toMatch(/\.carta-shell \.carta-pagina \{\s*overflow: visible !important;\s*\}/);
  });

  it("un plato o una tabla no se parten entre dos hojas; los rótulos de una tabla se repiten en cada hoja", () => {
    expect(IMPRESION).toMatch(/\.carta-shell \[data-carta-scroll\] > li,\s*\.carta-shell \[data-carta-scroll\] table \{\s*break-inside: avoid;/);
    expect(enPapel(".carta-shell thead")).toMatch(/display:\s*table-header-group/);
  });

  it("la escala en puntos (la de escala.ts), sin el tema; el pie se ve", () => {
    expect(IMPRESION).toMatch(/\.carta-rol-producto,\s*\.carta-shell \.carta-rol-precio \{\s*font-size: var\(--carta-fs-producto-impresa\) !important;/);
    expect(IMPRESION).toMatch(/\.carta-rol-opcion,\s*\.carta-shell \.carta-rol-opcion-precio \{\s*font-size: var\(--carta-fs-opcion-impresa\) !important;/);
    expect(IMPRESION).toMatch(/\.carta-rol-aclaracion,\s*\.carta-shell \.carta-rol-aclaracion-rotulo \{\s*font-size: var\(--carta-fs-aclaracion-impresa\) !important;/);
    expect(enPapel(".carta-shell .carta-solo-papel")).toMatch(/display:\s*block !important/);
    // En pantalla, el pie no se ve.
    expect(CSS).toMatch(/\.carta-shell \.carta-solo-papel \{\s*display: none;\s*\}/);
  });
});

describe("el pie de la carta impresa", () => {
  it("«Precios vigentes al <fecha del armado, en la hora de Argentina> · <dirección pública>»; sin dominio de cartas, solo la fecha", () => {
    // 02:30 UTC del 21/10 es todavía el 20/10 en Buenos Aires.
    expect(pieDeLaCartaImpresa("2026-10-21T02:30:00.000Z", "https://la-cuadra.cartas.ar/centro")).toBe("Precios vigentes al 20/10/2026 · https://la-cuadra.cartas.ar/centro");
    expect(pieDeLaCartaImpresa("2026-10-21T12:00:00.000Z", null)).toBe("Precios vigentes al 21/10/2026");
  });

  it("CartaVista lo dibuja al final, solo para el papel, con la dirección que le pasa la página", () => {
    const carta: CartaPublicaV1 = { version: 1, generadoEn: "2026-10-20T15:00:00.000Z", sucursal: { nombre: "Centro" }, secciones: [] };
    const html = renderToStaticMarkup(<CartaVista carta={carta} estilo={resolverEstiloCarta({})} direccionPublica="http://carta.localhost/centro" />);
    expect(html).toMatch(/<p data-carta-pie-impreso="true" class="carta-solo-papel[^"]*">Precios vigentes al 20\/10\/2026 · http:\/\/carta\.localhost\/centro<\/p><\/main>/);
  });
});
