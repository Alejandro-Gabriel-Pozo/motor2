import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ProductoParaEntrada } from "../../src/core/carta/public";
import { AgregarEntradaDeLugar } from "../../src/app/(app)/carta/agregar-entrada-de-lugar";

/**
 * Armar el lugar de una promo en la administración (etapa N1, PR B), el HTML con el que abre la pantalla: el origen (con la lista de secciones y «No está en la carta»), el origen inferido de lo que el lugar ya tiene, los
 * productos de ese origen con su casilla (los que ya están en la lista, tildados y bloqueados), el atajo por categoría, el aviso de los que no están en la lista y el botón. Lo interactivo (tildar, «el mozo elige», cambiar el
 * origen con aviso) lo cubren la lógica pura (`armar-lugar-de-lista.test.ts`) y el e2e.
 */
const bife: ProductoParaEntrada = {
  productoId: "bife",
  nombre: "BIFE-",
  grupos: [],
  seccionCartaId: "sec-principales",
  categoria: { id: "cat-carnes", nombre: "Carnes" },
  gruposAElegir: [{ grupoId: "g-prot", nombre: "Proteína", adicional: false, cantidadMinima: 1, cantidadMaxima: 1, opciones: [{ opcionId: "nalga", nombre: "Nalga" }] }],
};
const milanesa: ProductoParaEntrada = { productoId: "mila", nombre: "Milanesa", grupos: [], seccionCartaId: "sec-principales", categoria: { id: "cat-carnes", nombre: "Carnes" }, gruposAElegir: [] };
const agua: ProductoParaEntrada = { productoId: "agua", nombre: "Agua", grupos: [], seccionCartaId: null, categoria: null, gruposAElegir: [] };
const secciones = [{ id: "sec-principales", nombre: "Platos principales" }, { id: "sec-bebidas", nombre: "Bebidas" }];
const agregar = vi.fn();
const sacar = vi.fn();
const dibujar = (entradasActivas: { id: string; productoId: string }[]) =>
  renderToStaticMarkup(<AgregarEntradaDeLugar lugar="Plato principal" secciones={secciones} productos={[bife, milanesa, agua]} entradasActivas={entradasActivas} agregar={agregar} sacar={sacar} />);

describe("AgregarEntradaDeLugar: un lugar sin opciones", () => {
  const html = dibujar([]);

  it("pide el origen, con las secciones y «No está en la carta», y no muestra productos hasta elegirlo", () => {
    expect(html).toContain("De dónde salen los productos de «Plato principal»");
    expect(html).toContain("Sección «Platos principales»");
    expect(html).toContain("Sección «Bebidas»");
    expect(html).toContain("No está en la carta");
    expect(html).toContain("Elegí de dónde salen los productos");
    expect(html).not.toContain("data-producto-de-origen");
    expect(html).not.toContain(">Sumar<");
  });

  it("lleva el marcador que usa el e2e", () => {
    expect(html).toContain('data-agregar-entrada="Plato principal"');
  });
});

describe("AgregarEntradaDeLugar: un lugar que ya tiene opciones", () => {
  const html = dibujar([{ id: "e1", productoId: "bife" }]);

  it("abre en el origen de lo que ya tiene y muestra solo los productos de ese origen", () => {
    expect(html).toContain('<option value="sec-principales" selected="">');
    expect(html).toContain('data-producto-de-origen="BIFE-"');
    expect(html).toContain('data-producto-de-origen="Milanesa"');
    expect(html).not.toContain('data-producto-de-origen="Agua"');
  });

  it("lo que ya está en la lista se ve tildado y bloqueado, con su aviso", () => {
    expect(html).toMatch(/<input[^>]*checked=""[^>]*disabled=""|<input[^>]*disabled=""[^>]*checked=""/);
    expect(html).toContain("Ya está en la lista.");
  });

  it("avisa cuántos productos del origen no están en la lista (ninguno entra solo) y ofrece el atajo por categoría", () => {
    expect(html).toContain("Hay 1 producto");
    expect(html).toContain("ninguno entra solo");
    expect(html).toContain("Tildar todos los de una categoría");
    expect(html).toContain("Carnes (1)");
  });

  it("el botón de sumar arranca apagado (nada tildado)", () => {
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Sumar<\/button>/);
  });
});
