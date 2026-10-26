import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PestanasDeRuta, type PestanaDeRuta } from "../../src/ui/componentes/navegacion/pestanas-de-ruta";

/**
 * `PestanasDeRuta` (src/ui/componentes/navegacion/pestanas-de-ruta.tsx, Fase 6, paso 6.10b): la tira de pasos de un espacio donde cada pestaña es una ruta. `<nav>` con nombre, `aria-current="page"` en
 * la actual, una pestaña sin destino (`href: null`) como texto SIN enlace, e insignia opcional. Entorno de Vitest = Node: se mira el HTML del servidor.
 */
const PASOS: readonly PestanaDeRuta[] = [
  { href: "/catalogo/productos/p1/datos", texto: "Qué se vende", actual: true },
  { href: "/catalogo/productos/p1/opciones", texto: "Opciones y precio", actual: false, insignia: { tono: "aviso", texto: "Falta" } },
  { href: null, texto: "Receta", actual: false },
  { href: "/catalogo/productos/p1/en-la-carta", texto: "En la carta", actual: false },
];

const html = (pestanas: readonly PestanaDeRuta[] = PASOS) => renderToStaticMarkup(<PestanasDeRuta etiqueta="Pasos del producto" pestanas={pestanas} />);

describe("PestanasDeRuta", () => {
  it("es una <nav> con nombre accesible que lista las pestañas", () => {
    const h = html();
    expect(h).toMatch(/^<nav aria-label="Pasos del producto"><ul /);
    expect(h.match(/<li /g)).toHaveLength(4);
  });

  it("la pestaña actual lleva aria-current=page y ninguna otra", () => {
    const h = html();
    expect(h.match(/aria-current="page"/g)).toHaveLength(1);
    expect(h).toMatch(/<a [^>]*href="\/catalogo\/productos\/p1\/datos"[^>]*aria-current="page"|<a [^>]*aria-current="page"[^>]*href="\/catalogo\/productos\/p1\/datos"/);
  });

  it("las pestañas con destino son enlaces con su href", () => {
    const h = html();
    for (const ruta of ["/datos", "/opciones", "/en-la-carta"]) expect(h).toContain(`href="/catalogo/productos/p1${ruta}"`);
    expect(h.match(/<a /g)).toHaveLength(3);
  });

  it("href null: se dibuja como texto, sin <a> y sin href", () => {
    const h = html();
    expect(h).toMatch(/<span [^>]*>Receta<\/span>/);
    expect(h).not.toMatch(/<a [^>]*>Receta/);
    expect(h.match(/href=/g)).toHaveLength(3);
  });

  it("la insignia va dentro de la pestaña, con su texto", () => {
    expect(html()).toMatch(/Opciones y precio<span [^>]*>Falta<\/span><\/a>/);
  });

  it("sin ninguna actual no marca nada (por ejemplo, la portada fuera de los pasos)", () => {
    expect(html(PASOS.map((p) => ({ ...p, actual: false })))).not.toContain("aria-current");
  });

  it("la tira se desplaza hacia el costado y cada pestaña mide 44 px como mínimo", () => {
    const h = html();
    expect(h).toContain("overflow-x-auto");
    expect(h.match(/min-h-11/g)).toHaveLength(4);
  });

  it("etiqueta vacía o dos pestañas actuales: error en ejecución", () => {
    expect(() => renderToStaticMarkup(<PestanasDeRuta etiqueta="  " pestanas={PASOS} />)).toThrow(/etiqueta/);
    expect(() => html(PASOS.map((p) => ({ ...p, actual: true })))).toThrow(/solo una pestaña/);
  });

  it("solo tokens: ni modo oscuro ni colores de escala", () => {
    const h = html();
    expect(h).not.toMatch(/(^|[\s":])dark:/);
    expect(h).not.toMatch(/(^|[\s":-])(?:neutral|gray|slate|zinc|stone|red|green|amber|yellow|blue|white|black)-\d/);
  });
});
