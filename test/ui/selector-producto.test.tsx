import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// El buscador lee del servidor al escribir y usa el router para refrescar si la sesión venció: acá no se llama a ninguno de los dos (se dibuja cerrado o se prueba la lista suelta).
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));
vi.mock("../../src/server/actions/catalogo/productos", () => ({ buscarProductosSelector: vi.fn() }));

import { ListaDeResultados, SelectorProducto } from "../../src/components/selector-producto";
import type { ProductoOpcionConUnidad } from "../../src/server/actions/catalogo/productos";

/**
 * `SelectorProducto` (el buscador de producto compartido) con sus props opcionales nuevas del editor de recetas: `mostrarUnidad` (la unidad de stock en cada resultado), `onElegir` (entrega
 * la opción COMPLETA elegida), `name` (el id viaja en el formulario) y `textoSinResultados`. Sin ellas, se ve y se comporta como antes: hay otros cuatro pantallas que lo usan.
 * Entorno de Vitest = Node (sin DOM): se mira el HTML del servidor y se recorre el árbol de elementos de la lista, que no tiene estado propio.
 */
const NALGA: ProductoOpcionConUnidad = { id: "p1", codigo: "NAL-01", nombre: "Nalga", unidadStock: { id: "u-kg", nombre: "kg" } };
const HUEVOS: ProductoOpcionConUnidad = { id: "p2", codigo: "HUE-01", nombre: "Huevos", unidadStock: { id: "u-un", nombre: "unidad" } };

function propsDeLaLista(sobre: Partial<Parameters<typeof ListaDeResultados>[0]> = {}): Parameters<typeof ListaDeResultados>[0] {
  return { opciones: [NALGA, HUEVOS], resaltado: 0, idLista: "lista", idOpcion: (i) => `op-${i}`, mostrarUnidad: false, alElegir: () => undefined, alResaltar: () => undefined, ...sobre };
}

/** Todos los elementos del árbol que cumplen la condición (la lista es una función sin hooks: se llama directo y se recorre lo que devuelve). */
function buscar(nodo: ReactNode, cumple: (e: ReactElement<Record<string, unknown>>) => boolean, hallados: ReactElement<Record<string, unknown>>[] = []): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(nodo)) nodo.forEach((n) => buscar(n, cumple, hallados));
  else if (nodo && typeof nodo === "object" && "props" in nodo) {
    const elemento = nodo as ReactElement<Record<string, unknown>>;
    if (cumple(elemento)) hallados.push(elemento);
    buscar(elemento.props.children as ReactNode, cumple, hallados);
  }
  return hallados;
}

describe("ListaDeResultados", () => {
  it("sin `mostrarUnidad`: cada resultado es «código — nombre», sin unidad y sin la maqueta de dos columnas (igual que antes)", () => {
    const html = renderToStaticMarkup(<ListaDeResultados {...propsDeLaLista()} />);
    expect(html).toContain(">NAL-01 — Nalga</li>");
    expect(html).toContain(">HUE-01 — Huevos</li>");
    expect(html).not.toContain(">kg<");
    expect(html).not.toContain("justify-between");
    expect(html).toContain('class="cursor-pointer px-2 py-1.5 max-md:py-3 bg-superficie-suave"');
  });

  it("con `mostrarUnidad`: cada resultado muestra su unidad de stock (la de CADA producto)", () => {
    const html = renderToStaticMarkup(<ListaDeResultados {...propsDeLaLista({ mostrarUnidad: true })} />);
    expect(html).toMatch(/NAL-01.*Nalga.*<span[^>]*>kg<\/span><\/li>/);
    expect(html).toMatch(/HUE-01.*Huevos.*<span[^>]*>unidad<\/span><\/li>/);
    const [, nalga, huevos] = html.split("<li");
    expect(nalga).not.toContain("unidad");
    expect(huevos).not.toContain(">kg<");
  });

  it("elegir un resultado (el mousedown) entrega la opción completa, con su unidad, y no le saca el foco al campo", () => {
    const alElegir = vi.fn();
    const arbol = ListaDeResultados(propsDeLaLista({ mostrarUnidad: true, alElegir }));
    const opciones = buscar(arbol, (e) => e.props.role === "option");
    expect(opciones).toHaveLength(2);
    const prevenir = vi.fn();
    (opciones[1].props.onMouseDown as (e: { preventDefault: () => void }) => void)({ preventDefault: prevenir });
    expect(prevenir).toHaveBeenCalledTimes(1);
    expect(alElegir).toHaveBeenCalledExactlyOnceWith(HUEVOS);
    expect(alElegir.mock.calls[0][0].unidadStock).toEqual({ id: "u-un", nombre: "unidad" });
  });

  it("pasar el mouse por un resultado lo resalta (por su posición)", () => {
    const alResaltar = vi.fn();
    const arbol = ListaDeResultados(propsDeLaLista({ alResaltar }));
    (buscar(arbol, (e) => e.props.role === "option")[1].props.onMouseEnter as () => void)();
    expect(alResaltar).toHaveBeenCalledWith(1);
  });
});

describe("SelectorProducto, cerrado", () => {
  it("sin las props nuevas dibuja exactamente lo de antes: un campo de texto, el `<input>` oculto SIN nombre y ninguna lista", () => {
    const html = renderToStaticMarkup(<SelectorProducto value="" onChange={() => undefined} />);
    expect(html).toContain('<input type="hidden" value=""/>');
    expect(html).toContain('role="combobox"');
    expect(html).not.toContain('name="');
    expect(html).not.toContain("listbox");
  });

  it("con `name`, el id elegido viaja en el formulario con ese nombre", () => {
    const html = renderToStaticMarkup(<SelectorProducto value="p1" onChange={() => undefined} name="insumoProductoId" />);
    expect(html).toContain('<input type="hidden" name="insumoProductoId" value="p1"/>');
  });
});
