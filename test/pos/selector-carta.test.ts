import { describe, expect, it } from "vitest";
import type { CartaV1, ItemCartaV1, SeccionCartaV1 } from "../../src/core/carta/armar-menu";
import { armarSelectorCartaPos, type ProductoPedible, type SelectorCartaPos } from "../../src/core/pos/selector-carta";

/**
 * Armado PURO del selector por sección de carta del POS (docs/plan-selector-carta-pos-2026-09-25.md, paso 1): la estructura sale
 * de la carta, el precio y el código de los pedibles, y todo pedible que la carta no ubica cae en «Fuera de carta».
 */

const pedible = (productoId: string, nombre: string, precio: number): ProductoPedible => ({ productoId, codigo: `COD_${productoId}`, nombre, precio });

const suelto = (productoId: string, nombre: string, precio = 1): ItemCartaV1 => ({
  productoId,
  nombre,
  categoria: "x",
  descripcion: null,
  precio,
  tags: [],
  especial: false,
  imagenUrl: null,
});

const agrupado = (id: string, nombre: string, opciones: { productoId: string; nombre: string; precio?: number }[]): ItemCartaV1 => ({
  ...suelto(id, nombre),
  opciones: opciones.map((o) => ({ productoId: o.productoId, nombre: o.nombre, precio: o.precio ?? 1 })),
});

const seccion = (id: string, nombre: string, items: ItemCartaV1[], promos: SeccionCartaV1["promos"] = []): SeccionCartaV1 => ({
  id,
  nombre,
  titulo: null,
  descripcion: null,
  imagenUrl: null,
  orden: 0,
  items,
  promos,
});

const carta = (secciones: SeccionCartaV1[]): CartaV1 => ({ version: 1, generadoEn: "2026-09-25T12:00:00.000Z", sucursal: { id: "suc", nombre: "Central" }, secciones });

/** Todos los productoId que ofrece el selector (sueltos, opciones y «Fuera de carta»), con repetidos si los hubiera. */
function productoIdsOfrecidos(s: SelectorCartaPos): string[] {
  return [
    ...s.seccionesCarta.flatMap((sc) => sc.entradas.flatMap((e) => (e.tipo === "producto" ? [e.producto.productoId] : e.opciones.map((o) => o.productoId)))),
    ...s.fueraDeCarta.map((p) => p.productoId),
  ];
}

describe("armarSelectorCartaPos", () => {
  const bife = pedible("p-bife", "Bife de chorizo", 34000);
  const flan = pedible("p-flan", "Flan", 3000);
  const coca = pedible("p-coca", "Coca-Cola 500cc", 5000);
  const sprite = pedible("p-sprite", "Sprite 500cc", 5000);
  const agua = pedible("p-agua", "Agua", 2000);
  const pedibles = [bife, flan, coca, sprite, agua];

  it("sin carta (sucursal inactiva o sin nada publicado): todo va a «Fuera de carta», ordenado por nombre", () => {
    const s = armarSelectorCartaPos(null, pedibles);
    expect(s.seccionesCarta).toEqual([]);
    expect(s.fueraDeCarta.map((p) => p.nombre)).toEqual(["Agua", "Bife de chorizo", "Coca-Cola 500cc", "Flan", "Sprite 500cc"]);
  });

  it("los sueltos van a su sección respetando el orden de la carta (secciones e ítems), con precio y código de los pedibles", () => {
    const s = armarSelectorCartaPos(carta([seccion("s-postres", "Postres", [suelto("p-flan", "Flan", 999)]), seccion("s-platos", "Platos", [suelto("p-bife", "Bife de chorizo")])]), pedibles);
    expect(s.seccionesCarta).toEqual([
      { seccionCartaId: "s-postres", nombre: "Postres", entradas: [{ tipo: "producto", producto: flan }] },
      { seccionCartaId: "s-platos", nombre: "Platos", entradas: [{ tipo: "producto", producto: bife }] },
    ]);
    expect(s.fueraDeCarta.map((p) => p.productoId)).toEqual(["p-agua", "p-coca", "p-sprite"]);
  });

  it("un ítem agrupado lleva sus opciones en el orden de la carta, cada una con SU precio y código de los pedibles", () => {
    const s = armarSelectorCartaPos(
      carta([seccion("s-bebidas", "Bebidas", [suelto("p-agua", "Agua"), agrupado("ag-gaseosa", "Gaseosa 500cc", [{ productoId: "p-sprite", nombre: "Sprite", precio: 1 }, { productoId: "p-coca", nombre: "Coca" }])])]),
      pedibles
    );
    expect(s.seccionesCarta[0].entradas).toEqual([
      { tipo: "producto", producto: agua },
      { tipo: "agrupado", itemAgrupadoCartaId: "ag-gaseosa", nombre: "Gaseosa 500cc", precioMinimo: 5000, precioMaximo: 5000, opciones: [sprite, coca] },
    ]);
  });

  it("si las opciones de un agrupado cuestan distinto, lleva el rango (mínimo y máximo) y cada opción su precio real", () => {
    const spriteCara = { ...sprite, precio: 5500 };
    const s = armarSelectorCartaPos(
      carta([seccion("s-bebidas", "Bebidas", [agrupado("ag-gaseosa", "Gaseosa 500cc", [{ productoId: "p-coca", nombre: "Coca", precio: 5500 }, { productoId: "p-sprite", nombre: "Sprite", precio: 5500 }])])]),
      [coca, spriteCara]
    );
    const [entrada] = s.seccionesCarta[0].entradas;
    expect(entrada).toMatchObject({ tipo: "agrupado", precioMinimo: 5000, precioMaximo: 5500 });
    expect(entrada.tipo === "agrupado" && entrada.opciones.map((o) => o.precio)).toEqual([5000, 5500]);
  });

  it("las promos se ignoran: una sección que solo tiene promos se descarta", () => {
    const promo = { id: "promo-1", titulo: "2x1", descripcion: null, precio: 100, orden: 0 };
    const s = armarSelectorCartaPos(carta([seccion("s-promos", "Promos", [], [promo]), seccion("s-platos", "Platos", [suelto("p-bife", "Bife de chorizo")], [promo])]), pedibles);
    expect(s.seccionesCarta.map((sc) => sc.seccionCartaId)).toEqual(["s-platos"]);
    expect(s.seccionesCarta[0].entradas).toHaveLength(1);
  });

  it("defensa: un ítem u opción que no está entre los pedibles se descarta; un agrupado sin opciones pedibles, también; y una sección que queda vacía", () => {
    const s = armarSelectorCartaPos(
      carta([
        seccion("s-platos", "Platos", [suelto("p-fantasma", "No pedible"), suelto("p-bife", "Bife de chorizo")]),
        seccion("s-bebidas", "Bebidas", [agrupado("ag-gaseosa", "Gaseosa 500cc", [{ productoId: "p-coca", nombre: "Coca" }, { productoId: "p-fanta", nombre: "Fanta" }]), agrupado("ag-vacio", "Jugos", [{ productoId: "p-jugo", nombre: "Jugo" }])]),
        seccion("s-vacia", "Vacía", [suelto("p-otro-fantasma", "Nada")]),
      ]),
      pedibles
    );
    expect(s.seccionesCarta.map((sc) => sc.seccionCartaId)).toEqual(["s-platos", "s-bebidas"]);
    expect(s.seccionesCarta[0].entradas).toEqual([{ tipo: "producto", producto: bife }]);
    expect(s.seccionesCarta[1].entradas).toEqual([{ tipo: "agrupado", itemAgrupadoCartaId: "ag-gaseosa", nombre: "Gaseosa 500cc", precioMinimo: 5000, precioMaximo: 5000, opciones: [coca] }]);
  });

  it("un productoId repetido (en la carta o en los pedibles) se ubica una sola vez: la primera", () => {
    const s = armarSelectorCartaPos(
      carta([
        seccion("s-platos", "Platos", [suelto("p-bife", "Bife de chorizo"), suelto("p-bife", "Bife de chorizo")]),
        seccion("s-bebidas", "Bebidas", [agrupado("ag-gaseosa", "Gaseosa 500cc", [{ productoId: "p-bife", nombre: "Bife" }, { productoId: "p-coca", nombre: "Coca" }])]),
      ]),
      [...pedibles, flan]
    );
    expect(s.seccionesCarta[0].entradas).toEqual([{ tipo: "producto", producto: bife }]);
    expect(s.seccionesCarta[1].entradas[0]).toMatchObject({ tipo: "agrupado", opciones: [coca] });
    expect(s.fueraDeCarta.filter((p) => p.productoId === "p-flan")).toHaveLength(1);
  });

  it("invariante: cada pedible aparece exactamente una vez y ningún id de ítem agrupado aparece como productoId", () => {
    const s = armarSelectorCartaPos(
      carta([
        seccion("s-platos", "Platos", [suelto("p-bife", "Bife de chorizo"), suelto("p-no-pedible", "X")]),
        seccion("s-bebidas", "Bebidas", [agrupado("ag-gaseosa", "Gaseosa 500cc", [{ productoId: "p-coca", nombre: "Coca" }, { productoId: "p-sprite", nombre: "Sprite" }]), agrupado("ag-vacio", "Vacío", [])]),
      ]),
      pedibles
    );
    const ofrecidos = productoIdsOfrecidos(s);
    expect(new Set(ofrecidos).size).toBe(ofrecidos.length);
    expect([...ofrecidos].sort()).toEqual(pedibles.map((p) => p.productoId).sort());
    for (const idAgrupado of ["ag-gaseosa", "ag-vacio"]) expect(ofrecidos).not.toContain(idAgrupado);
    const idsDeAgrupados = s.seccionesCarta.flatMap((sc) => sc.entradas.flatMap((e) => (e.tipo === "agrupado" ? [e.itemAgrupadoCartaId] : [])));
    expect(idsDeAgrupados).toEqual(["ag-gaseosa"]);
  });
});
