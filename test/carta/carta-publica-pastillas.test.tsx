import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { resolverEstiloCarta, type CartaV1 } from "../../src/core/carta/public";
import { proyectarCartaPublica } from "../../src/core/carta/public";
import { Seccion } from "../../src/components/carta-publica/seccion";

/**
 * CARTA-C (pastillas): lo que DIBUJA la carta con `opcionesSinCosto`, sin base ni navegador. La regla de qué opciones llegan es del servidor (`opciones-en-carta.test.ts`); acá se prueba la
 * proyección pública (campo por campo, solo textos) y el dibujo: etiqueta con el nombre del grupo, una pastilla por opción, en orden, sin botones, y el texto del negocio escapado.
 */
const carta = (opcionesSinCosto: unknown): CartaV1 =>
  ({
    version: 1,
    generadoEn: "2026-10-14T12:00:00.000Z",
    sucursal: { id: "suc-interna", nombre: "Central" },
    secciones: [
      {
        id: "sec-interna",
        nombre: "Platos",
        titulo: null,
        descripcion: null,
        imagenUrl: null,
        orden: 0,
        items: [{ productoId: "prod-interno", nombre: "Milanesa", categoria: "Platos", descripcion: null, precio: 9500, tags: [], especial: false, imagenUrl: null, opcionesSinCosto }],
        promos: [],
      },
    ],
  }) as unknown as CartaV1;

const dibujar = (opcionesSinCosto: unknown) => {
  const publica = proyectarCartaPublica(carta(opcionesSinCosto));
  return { publica, html: renderToStaticMarkup(<Seccion seccion={publica.secciones[0]!} indice={0} total={1} estilo={resolverEstiloCarta({})} />) };
};

describe("la carta dibuja las opciones sin costo como pastillas", () => {
  it("la proyección pública copia SOLO el nombre del grupo y los nombres de las opciones: ningún campo interno cruza", () => {
    const { publica } = dibujar([{ grupo: "Guarnición", opciones: ["Papas fritas", "Puré"], id: "grupo-interno", precio: 300, recargo: 5 }]);
    expect(publica.secciones[0]!.items[0]!.opcionesSinCosto).toEqual([{ grupo: "Guarnición", opciones: ["Papas fritas", "Puré"] }]);
    const salida = JSON.stringify(publica);
    for (const interno of ["grupo-interno", "prod-interno", "sec-interna", "suc-interna", "300", '"recargo"']) expect(salida, interno).not.toContain(interno);
  });

  it("un ítem sin opciones sin costo no lleva la clave", () => {
    expect("opcionesSinCosto" in proyectarCartaPublica({ ...carta(undefined) }).secciones[0]!.items[0]!).toBe(false);
  });

  it("la etiqueta con el nombre del grupo y una pastilla por opción, en orden, dentro de una lista con el nombre del grupo; sin botones", () => {
    const { html } = dibujar([{ grupo: "Guarnición", opciones: ["Papas fritas", "Puré", "Ensalada"] }]);
    expect(html).toMatch(/data-opciones-sin-costo="Guarnición"/);
    expect(html).toMatch(/<p[^>]*aria-hidden="true"[^>]*>Guarnición<\/p>/);
    expect(html).toMatch(/<ul aria-label="Guarnición"[^>]*>.*Papas fritas.*Puré.*Ensalada/);
    expect(html.match(/<li[^>]*rounded-full/g)).toHaveLength(3);
    expect(html).not.toMatch(/role="button"|tabindex|<button|<details/);
  });

  it("los nombres del negocio se escapan como cualquier texto de React (no son HTML crudo)", () => {
    const { html } = dibujar([{ grupo: '<img src=x onerror="alert(1)">', opciones: ["<b>Solo</b>", "Flat white"] }]);
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<b>Solo</b>");
    expect(html).toContain("&lt;b&gt;Solo&lt;/b&gt;");
    expect(html).toContain("&lt;img src=x onerror=");
  });

  it("los colores salen de las variables del tema, no de colores fijos; las pastillas no se repiten en la línea «Adicionales:»", () => {
    const { html } = dibujar([{ grupo: "Preparación", opciones: ["Solo", "Flat white"] }]);
    expect(html).toContain("var(--carta-ink-soft)");
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
    expect(html).not.toContain("Adicionales:");
  });
});
