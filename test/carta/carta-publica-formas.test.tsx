import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { recargoEnPesos, resolverEstiloCarta, textoDeLaAclaracion, type ItemCartaPublico, type SeccionCartaPublica } from "../../src/core/carta/public";
import { Seccion } from "../../src/components/carta-publica/seccion";

/**
 * Fase 5 de la ola «precio y carta» («carta pareja», ADR-035), paso 8: lo que DIBUJA la carta pública con la forma de cada producto (`presentacion`, que resuelve el servidor), sin base ni navegador.
 * La forma y sus precios los fija `presentacion-en-carta.test.ts`; acá, el HTML: qué se lee, en qué orden, con qué rol de la escala y con qué estructura (títulos, tablas reales con sus encabezados).
 * Sin `presentacion` (una carta guardada por el código anterior) se dibuja como antes.
 */

const item = (extra: Partial<ItemCartaPublico> & { nombre: string }): ItemCartaPublico => ({ categoria: "Platos", descripcion: null, precio: 0, tags: [], especial: false, imagenUrl: null, ...extra });

const dibujar = (items: ItemCartaPublico[], tandas?: SeccionCartaPublica["tandas"]) =>
  renderToStaticMarkup(
    <Seccion
      seccion={{ nombre: "Platos", titulo: null, descripcion: null, imagenUrl: null, orden: 0, items, promos: [], ...(tandas ? { tandas } : {}) }}
      indice={0}
      total={1}
      estilo={resolverEstiloCarta({})}
    />,
  );

/** El texto visible de un fragmento de HTML (sin etiquetas, sin lo que es solo para el lector de pantalla). */
const texto = (html: string) =>
  html
    .replace(/<span class="sr-only">[^<]*<\/span>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

/** El `<li>` de la sección que contiene `marca`. */
const filaCon = (html: string, marca: string) => {
  const lis = html.slice(html.indexOf("data-carta-scroll")).split(/(?=<li data-forma|<li class|<li data-tanda)/);
  return lis.find((l) => l.includes(marca)) ?? "";
};

describe("los textos de la forma (compartidos con la vista previa de la administración)", () => {
  it("una elección se une con «o» (y «u» delante de o/ho); unos extras, con comas y lo que suma cada uno", () => {
    expect(textoDeLaAclaracion({ tipo: "eleccion", rotulo: "Guarnicion", opciones: ["ensalada", "papas fritas", "puré"] })).toBe("ensalada, papas fritas o puré");
    expect(textoDeLaAclaracion({ tipo: "eleccion", rotulo: "Cocción", opciones: ["jugoso", "horneado"] })).toBe("jugoso u horneado");
    expect(textoDeLaAclaracion({ tipo: "extras", rotulo: "Extras", opciones: [{ nombre: "extra de papas", recargo: 2000 }, { nombre: "huevo frito", recargo: 1500 }] })).toBe("extra de papas +$2.000, huevo frito +$1.500");
    expect(textoDeLaAclaracion({ tipo: "extras", rotulo: "Preparación", opciones: [{ nombre: "solo", recargo: 0 }, { nombre: "con leche", recargo: 300 }, { nombre: "sin azúcar", recargo: -100 }] })).toBe("solo, con leche +$300, sin azúcar −$100");
    expect(recargoEnPesos(-300)).toBe("−$300");
  });
});

describe("8a: forma simple (el bife: su precio y las aclaraciones debajo)", () => {
  const bife = item({
    nombre: "Bife a la criolla",
    precio: 20000,
    descripcion: "Con salsa criolla",
    presentacion: {
      forma: "simple",
      aclaraciones: [
        { tipo: "eleccion", rotulo: "Guarnicion", opciones: ["ensalada", "papas fritas", "puré"] },
        { tipo: "extras", rotulo: "Extras", opciones: [{ nombre: "extra de papas", recargo: 2000 }, { nombre: "huevo frito", recargo: 1500 }] },
      ],
    },
  });
  const html = filaCon(dibujar([bife]), "Bife a la criolla");

  it("el nombre (h3, rol Producto) con su precio (rol Precio), la descripción y una línea por aclaración, en orden, con el rótulo en Aclaración 600", () => {
    expect(html).toMatch(/^<li data-forma="simple"/);
    expect(html).toMatch(/<h3 data-rol="producto"[^>]*>Bife a la criolla<\/h3>/);
    expect(html).toMatch(/data-rol="precio"[^>]*>\$20\.000<\/span>/);
    expect(texto(html)).toBe("Bife a la criolla $20.000 Con salsa criolla Guarnicion: ensalada, papas fritas o puré Extras: extra de papas +$2.000, huevo frito +$1.500");
    expect(html.match(/<p data-aclaracion="[^"]*" data-rol="aclaracion" class="carta-rol-aclaracion/g)).toHaveLength(2);
    expect(html).toMatch(/<span data-rol="aclaracion-rotulo" class="carta-rol-aclaracion-rotulo"[^>]*>Guarnicion:<\/span>/);
  });

  it("sin las listas de antes (ni tamaños, ni pastillas, ni «Adicionales:»), aunque el ítem traiga también `grupos` y `opcionesSinCosto`", () => {
    const conLoViejo = filaCon(
      dibujar([{ ...bife, grupos: [{ nombre: "Extras", opciones: [{ nombre: "Huevo frito", tipo: "recargo", recargo: 1500 }] }], opcionesSinCosto: [{ grupo: "Guarnicion", opciones: ["Ensalada", "Puré"] }] }]),
      "Bife a la criolla",
    );
    expect(conLoViejo).not.toMatch(/data-tamanos-carta|data-opciones-sin-costo|data-suma-carta|Adicionales:/);
  });

  it("sin `presentacion` (una carta guardada por el código anterior) se dibuja como antes", () => {
    const viejo = filaCon(dibujar([item({ nombre: "Café", precio: 2500, grupos: [{ nombre: "Tamaño", opciones: [{ nombre: "Chico", tipo: "final", precio: 2500 }] }] })]), "Café");
    expect(viejo).toMatch(/data-tamanos-carta="Tamaño"/);
  });

  it("los nombres del negocio se escapan (no son HTML crudo)", () => {
    const raro = filaCon(dibujar([item({ nombre: "Plato", precio: 1, presentacion: { forma: "simple", aclaraciones: [{ tipo: "eleccion", rotulo: "<b>G</b>", opciones: ['<img src=x onerror="alert(1)">', "b"] }] } })]), "Plato");
    expect(raro).not.toContain("<img src=x");
    expect(raro).toContain("&lt;b&gt;G&lt;/b&gt;:");
  });
});
