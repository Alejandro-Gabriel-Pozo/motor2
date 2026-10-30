import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { VistaPreviaDeLaCarta as Vista } from "../../src/core/carta/public";
import { VistaPreviaDeLaCarta } from "../../src/components/catalogo/espacio-del-producto/vista-previa-de-la-carta";

/**
 * Fase 6, bloque 3, 6.18: el componente que DIBUJA la vista previa de un producto en la carta. Solo muestra lo que el servidor ya calculó: cada forma de la carta (el producto con su precio o la tabla,
 * que se dibuja con el mismo componente que la carta pública), lo que se lee debajo, el producto sin opciones y el que hoy no se puede pedir. Una celda sin precio dice «–» y, para el lector de pantalla, «no se ofrece». El HTML del servidor
 * (el entorno de Vitest es Node): sin formularios ni botones, y solo tokens del sistema visual.
 */
const dibujar = (vista: Vista) => renderToStaticMarkup(<VistaPreviaDeLaCarta nombre="Café" sucursalNombre="Central" vista={vista} />);
const texto = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("VistaPreviaDeLaCarta", () => {
  it("siempre dice de qué sucursal es el precio, que es de lista sin descuentos, y es una región con nombre", () => {
    const html = dibujar({ tipo: "sin-opciones" });
    expect(html).toContain('aria-labelledby="titulo-vista-previa-de-la-carta"');
    expect(texto(html)).toContain("Cómo se va a ver en la carta");
    expect(texto(html)).toContain("precio de lista de «Central», sin descuentos");
  });

  it("sin opciones: sale con su nombre y su precio", () => {
    expect(texto(dibujar({ tipo: "sin-opciones" }))).toContain("Café sin opciones: sale con su nombre y su precio.");
  });

  it("no se puede pedir: un aviso que lo dice, sin tabla", () => {
    const html = dibujar({ tipo: "no-se-puede-pedir" });
    expect(texto(html)).toContain("Hoy no se puede pedir");
    expect(html).not.toContain("<table");
  });

  it("texto: la línea que arma el servidor, tal cual", () => {
    expect(texto(dibujar({ tipo: "texto", texto: "Va a mostrar: Tamaño: Chico $ 4.000." }))).toContain("Va a mostrar: Tamaño: Chico $ 4.000.");
  });

  it("tabla de un eje (el café): sus tamaños como encabezados, una sola fila, el precio de cada uno y «no se ofrece» donde no hay precio; el nombre es el título y lo que se elige va debajo", () => {
    const html = dibujar({ tipo: "forma", presentacion: { forma: "tabla", titulo: true, columnas: ["Chico", "Grande"], filas: [{ rotulo: null, celdas: [4000, null] }], aclaraciones: [{ tipo: "eleccion", rotulo: "Preparación", opciones: ["solo", "cortado"] }] } });
    expect(html.match(/<th scope="col"/g)).toHaveLength(2);
    const t = texto(html);
    expect(t).toContain("Café Chico Grande");
    expect(t).toContain("$4.000");
    expect(t).toContain("Preparación solo · cortado");
    expect(html).toContain('<span class="sr-only">no se ofrece</span>');
  });

  it("tabla de dos ejes: columnas, filas con encabezado de fila y un precio por celda", () => {
    const html = dibujar({ tipo: "forma", presentacion: { forma: "tabla", titulo: true, columnas: ["Simple", "Napolitana"], filas: [{ rotulo: "De carne", celdas: [20000, 25000] }], aclaraciones: [] } });
    expect(html).toContain('<th scope="row"');
    expect(texto(html)).toMatch(/De carne \$20\.000 \$25\.000/);
  });

  it("una columna de precios: con el nombre arriba (el nombre es el título) o la base oculta (cada opción como un plato, sin nombre)", () => {
    const filas = [{ rotulo: "Muzzarella", celdas: [18000] }];
    expect(texto(dibujar({ tipo: "forma", presentacion: { forma: "tabla", titulo: true, columnas: [], filas, aclaraciones: [] } }))).toContain("Café Muzzarella $18.000");
    const oculta = texto(dibujar({ tipo: "forma", presentacion: { forma: "tabla", titulo: false, columnas: [], filas, aclaraciones: [] } }));
    expect(oculta).toContain("Muzzarella $18.000");
    expect(oculta).not.toContain("Café Muzzarella");
  });

  it("simple: el producto con su precio y lo que se lee debajo (los extras con su recargo)", () => {
    const t = texto(dibujar({ tipo: "forma", presentacion: { forma: "simple", aclaraciones: [{ tipo: "extras", rotulo: "Extras", opciones: [{ nombre: "huevo", recargo: 1500 }] }] } }));
    expect(t).toContain("Café con su precio.");
    expect(t).toContain("Extras: huevo +$1.500");
  });

  it("solo dibuja: ni formularios, ni botones, ni enlaces, ni modo oscuro", () => {
    for (const vista of [{ tipo: "sin-opciones" }, { tipo: "no-se-puede-pedir" }, { tipo: "forma", presentacion: { forma: "tabla", titulo: true, columnas: ["A"], filas: [{ rotulo: null, celdas: [1] }], aclaraciones: [] } }] as Vista[]) {
      const html = dibujar(vista);
      expect(html).not.toMatch(/<(form|button|input|select|textarea|a )/);
      expect(html).not.toContain("dark:");
    }
  });
});
