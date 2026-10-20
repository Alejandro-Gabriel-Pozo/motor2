import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ESCALA_DE_LA_CARTA, ESCALA_IMPRESA, variablesDeLaEscala } from "../../src/core/carta/escala";
import { resolverEstiloCarta, type SeccionCartaPublica } from "../../src/core/carta/public";
import { Seccion } from "../../src/components/carta-publica/seccion";

/**
 * Fase 5 de la ola «precio y carta» (DEC-35, ADR-035): la ESCALA DE LETRA ÚNICA de la carta pública. Fija:
 *  - los pisos de cada rol (`src/core/carta/escala.ts`, un solo lugar) y que el tema de la sucursal manda solo hacia ARRIBA (`max(piso, tema)`): un tema que pide menos queda en el piso;
 *  - que `globals.css` da a cada rol UN tamaño (la variable de la escala, nunca un número) y UN peso;
 *  - que todo ítem lleva los mismos roles: con o sin opciones, plato o promo (antes solo los ítems con opciones tenían piso) y que ningún texto del ítem escribe su tamaño.
 * El tamaño computado en el navegador (un solo par tamaño/peso por rol, a 375 y 1280 px) lo fija la línea de base de navegador (`test/e2e/linea-de-base-precio-y-carta.spec.ts`).
 *
 * Mutaciones demostradas (rojo y revertidas; ver `logs/fase5b`): sacar el `max()` (el tema chico baja del piso); devolverle a una fila de opción un tamaño fijo; volver el default del tema a 0.88rem
 * (rojo en `tema.test.ts`); que un ítem sin opciones pierda el rol.
 */

const CSS = readFileSync(join(__dirname, "../../src/app/globals.css"), "utf8");

/** Las declaraciones de la regla `.carta-shell .<clase>` en pantalla (la primera, fuera de `@media print`). */
function reglaDe(clase: string): Record<string, string> {
  const m = CSS.match(new RegExp(String.raw`\.carta-shell \.${clase} \{([^}]*)\}`));
  if (!m) return {};
  return Object.fromEntries(
    m[1]!
      .split(";")
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => [d.slice(0, d.indexOf(":")).trim(), d.slice(d.indexOf(":") + 1).trim()]),
  );
}

describe("la escala de letra única (DEC-35)", () => {
  it("los pisos: Producto 19 px, Opción 16 px, Aclaración 14 px, Etiqueta 12 px; en papel 12/11/10/9 pt", () => {
    expect(ESCALA_DE_LA_CARTA).toMatchObject({ producto: "1.1875rem", opcion: "1rem", aclaracion: "0.875rem", etiqueta: "0.75rem" });
    expect(ESCALA_IMPRESA).toMatchObject({ producto: "12pt", opcion: "11pt", aclaracion: "10pt", etiqueta: "9pt" });
  });

  it("el tema manda solo hacia arriba: cada variable es max(piso, tema); la Opción no tiene tema", () => {
    const v = variablesDeLaEscala({ nombre: "0.8rem", precio: "clamp(1rem, 2vw, 1.5rem)", descripcion: "11px", tags: "0.6rem" });
    expect(v["--carta-fs-producto"]).toBe("max(1.1875rem, 0.8rem)");
    expect(v["--carta-fs-precio"]).toBe("max(1.1875rem, clamp(1rem, 2vw, 1.5rem))");
    expect(v["--carta-fs-aclaracion"]).toBe("max(0.875rem, 11px)");
    expect(v["--carta-fs-etiqueta"]).toBe("max(0.75rem, 0.6rem)");
    expect(v["--carta-fs-opcion"]).toBe("1rem");
    expect(v["--carta-fs-producto-impresa"]).toBe("12pt");
    // Sin tema (el portal), el piso solo.
    expect(variablesDeLaEscala()["--carta-fs-producto"]).toBe("1.1875rem");
  });

  it("resolverEstiloCarta pone la escala en la raíz de la carta, con el tema guardado (también uno más chico que el piso) y con los defaults", () => {
    expect(resolverEstiloCarta({}).variablesCss["--carta-fs-producto"]).toBe("max(1.1875rem, 1.1875rem)");
    const chico = resolverEstiloCarta({ carta_fuente_item_nombre: "12", carta_fuente_item_descripcion: "0.6rem" }).variablesCss;
    expect(chico["--carta-fs-producto"]).toBe("max(1.1875rem, 12px)");
    expect(chico["--carta-fs-aclaracion"]).toBe("max(0.875rem, 0.6rem)");
  });

  it("globals.css: cada rol tiene UN tamaño (la variable de la escala, nunca un número) y UN peso", () => {
    const esperado: Record<string, { size: string; weight: string }> = {
      "carta-rol-producto": { size: "var(--carta-fs-producto)", weight: "600" },
      "carta-rol-precio": { size: "var(--carta-fs-precio)", weight: "600" },
      "carta-rol-opcion": { size: "var(--carta-fs-opcion)", weight: "400" },
      "carta-rol-opcion-precio": { size: "var(--carta-fs-opcion)", weight: "600" },
      "carta-rol-aclaracion": { size: "var(--carta-fs-aclaracion)", weight: "400" },
      "carta-rol-aclaracion-rotulo": { size: "var(--carta-fs-aclaracion)", weight: "600" },
      "carta-rol-etiqueta": { size: "var(--carta-fs-etiqueta)", weight: "400" },
    };
    for (const [clase, { size, weight }] of Object.entries(esperado)) {
      const r = reglaDe(clase);
      expect(r["font-size"], clase).toBe(size);
      expect(r["font-weight"], clase).toBe(weight);
    }
  });
});

describe("todo ítem lleva los mismos roles (DEC-35: el piso vale para todo ítem)", () => {
  const seccion: SeccionCartaPublica = {
    nombre: "Platos",
    titulo: null,
    descripcion: null,
    imagenUrl: null,
    orden: 0,
    items: [
      { nombre: "Gaseosa", categoria: "Bebidas", descripcion: "500 cc", precio: 4000, tags: ["frío"], especial: false, imagenUrl: null },
      { nombre: "Flan", categoria: "Postres", descripcion: null, precio: 3600, precioLista: 4000, descuentoPorcentaje: 10, tags: [], especial: true, imagenUrl: null },
      {
        nombre: "Café",
        categoria: "Cafetería",
        descripcion: null,
        precio: 2500,
        tags: [],
        especial: false,
        imagenUrl: null,
        grupos: [
          { nombre: "Tamaño", opciones: [{ nombre: "Chico", tipo: "final", precio: 2500 }, { nombre: "Grande", tipo: "final", precio: 3100 }] },
          { nombre: "Extras", opciones: [{ nombre: "Medialuna", tipo: "recargo", recargo: 600 }] },
        ],
        opcionesSinCosto: [{ grupo: "Preparación", opciones: ["Solo", "Cortado"] }],
      },
    ],
    promos: [{ titulo: "Promo", descripcion: "Dos por uno", precio: 9000, orden: 0 }],
  };
  const html = renderToStaticMarkup(<Seccion seccion={seccion} indice={0} total={1} estilo={resolverEstiloCarta({ carta_fuente_item_nombre: "0.8rem" })} />);

  it("el nombre de un plato (con o sin opciones) y el de una promo van en el rol Producto, su precio en el rol Precio, la descripción en Aclaración y los tags en Etiqueta", () => {
    expect(html.match(/<h3 data-rol="producto" class="carta-rol-producto[^"]*"/g)).toHaveLength(4);
    expect(html.match(/data-rol="precio" class="carta-rol-precio/g)).toHaveLength(3);
    // Las filas de opción (rol Opción) y lo que se lee debajo (rol Aclaración), también en un ítem con opciones.
    expect(html.match(/data-rol="opcion" class="carta-rol-opcion[ "]/g)).toHaveLength(2);
    expect(html.match(/data-rol="opcion-precio" class="carta-rol-opcion-precio[ "]/g)).toHaveLength(2);
    expect(html).toMatch(/<p data-rol="aclaracion" class="carta-rol-aclaracion[^"]*"[^>]*>500 cc<\/p>/);
    expect(html).toMatch(/<p data-rol="aclaracion" class="carta-rol-aclaracion[^"]*"[^>]*>Dos por uno<\/p>/);
    expect(html).toMatch(/data-rol="etiqueta" class="carta-rol-etiqueta[^"]*"/);
  });

  it("ningún texto del ítem escribe su propio tamaño (ni el tema en línea: lo aplica la variable de la escala)", () => {
    const lista = html.slice(html.indexOf("data-carta-scroll"));
    expect(lista).not.toMatch(/font-size/);
    expect(lista).not.toMatch(/\btext-(xs|sm|base|lg|xl)\b/);
  });
});
