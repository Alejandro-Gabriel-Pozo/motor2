import { describe, expect, it } from "vitest";
import { cantidadElegida, eleccionParaAgregar, estadoInicialArmarPromo, puedeConfirmarArmarPromo, reducirArmarPromo, totalElegidoDelCupo } from "../../src/core/pos/armar-promo-estado";
import type { EntradaPromoSelectorCarta, ProductoPedible } from "../../src/core/pos/selector-carta";

/**
 * GO-3b (ADR-032, F6 paso U5): el reductor de «Armar promo» con cupos de ENTRADAS (sin DOM). El menú del día: un cupo de sección (las entradas de la carta), un DEL_DIA (el plato de hoy), un
 * LISTA FIJO (el postre, que completa el servidor) y un LISTA de dos cafés configurados. Fija: el fijo arranca completo y no se toca ni viaja; los cupos de entradas se eligen por entrada y viajan
 * por `cupoId`; un DEL_DIA sin plato no deja confirmar; el orden de los cupos es el de la promo.
 *
 * Mutaciones demostradas (rojo y revertidas): no ignorar las acciones sobre un fijo (rojo: «fijo»); mandar el fijo en la elección (rojo: «no viaja»); sumar una entrada que el cupo no ofrece
 * (rojo: «sin cargar»).
 */
const pedible = (productoId: string): ProductoPedible => ({ productoId, codigo: productoId, nombre: productoId, precio: 1000, decimales: 0, pasoVenta: null, tieneStockReal: false });

const menu = (platos: { entradaId: string; productoId: string; nombre: string; precioLista: number }[]): EntradaPromoSelectorCarta => ({
  tipo: "promo",
  promoCartaId: "menu",
  titulo: "Menú del día",
  precio: 10000,
  cupos: [
    { seccionCartaId: "s-entradas", nombreSeccion: "Entradas", cantidadMinima: 0, cantidadMaximaCupo: 1, elegibles: [pedible("empanada")] },
    { cupoId: "c-plato", tipo: "DEL_DIA", nombre: "Plato del día", cantidadMinima: 1, cantidadMaximaCupo: 1, fijo: false, entradas: platos },
    { cupoId: "c-postre", tipo: "LISTA", nombre: "Postre", cantidadMinima: 1, cantidadMaximaCupo: 1, fijo: true, entradas: [{ entradaId: "e-flan", productoId: "flan", nombre: "Flan", precioLista: 3000 }] },
    {
      cupoId: "c-cafe",
      tipo: "LISTA",
      nombre: "Café",
      cantidadMinima: 1,
      cantidadMaximaCupo: 2,
      fijo: false,
      entradas: [
        { entradaId: "e-chico", productoId: "cafe", nombre: "Café · Chico", precioLista: 950 },
        { entradaId: "e-grande", productoId: "cafe", nombre: "Café · Grande", precioLista: 1100 },
      ],
    },
  ],
});
const platos = [
  { entradaId: "e-mila", productoId: "mila", nombre: "Milanesa", precioLista: 9000 },
  { entradaId: "e-pizza", productoId: "pizza", nombre: "Pizza", precioLista: 12000 },
];

describe("Armar promo con cupos de entradas (GO-3b, U5)", () => {
  it("el fijo arranca completo y no se toca; los demás se eligen por entrada", () => {
    let estado = estadoInicialArmarPromo(menu(platos));
    expect(totalElegidoDelCupo(estado, "c-postre")).toBe(1);
    expect(reducirArmarPromo(estado, { tipo: "decrementar", seccionCartaId: "c-postre", productoId: "e-flan" })).toBe(estado);
    expect(reducirArmarPromo(estado, { tipo: "incrementar", seccionCartaId: "c-postre", productoId: "e-flan" })).toBe(estado);
    expect(puedeConfirmarArmarPromo(estado)).toBe(false);
    estado = reducirArmarPromo(estado, { tipo: "incrementar", seccionCartaId: "c-plato", productoId: "e-pizza" });
    estado = reducirArmarPromo(estado, { tipo: "incrementar", seccionCartaId: "c-cafe", productoId: "e-grande" });
    estado = reducirArmarPromo(estado, { tipo: "incrementar", seccionCartaId: "c-cafe", productoId: "e-grande" });
    // Tope del cupo (2): el chico ya no entra.
    estado = reducirArmarPromo(estado, { tipo: "incrementar", seccionCartaId: "c-cafe", productoId: "e-chico" });
    expect([cantidadElegida(estado, "c-cafe", "e-grande"), cantidadElegida(estado, "c-cafe", "e-chico")]).toEqual([2, 0]);
    expect(puedeConfirmarArmarPromo(estado)).toBe(true);
  });

  it("la elección viaja en el orden de la promo: la sección por producto, los de entradas por `cupoId` y entrada; el fijo no viaja", () => {
    let estado = estadoInicialArmarPromo(menu(platos));
    estado = reducirArmarPromo(estado, { tipo: "incrementar", seccionCartaId: "c-plato", productoId: "e-mila" });
    estado = reducirArmarPromo(estado, { tipo: "incrementar", seccionCartaId: "c-cafe", productoId: "e-chico" });
    expect(eleccionParaAgregar(estado)).toEqual([
      { seccionCartaId: "s-entradas", elegidos: [] },
      { cupoId: "c-plato", elegidos: [{ entradaId: "e-mila", cantidad: 1 }] },
      { cupoId: "c-cafe", elegidos: [{ entradaId: "e-chico", cantidad: 1 }] },
    ]);
  });

  it("un plato del día sin cargar no deja confirmar", () => {
    let estado = estadoInicialArmarPromo(menu([]));
    estado = reducirArmarPromo(estado, { tipo: "incrementar", seccionCartaId: "c-cafe", productoId: "e-chico" });
    expect(puedeConfirmarArmarPromo(estado)).toBe(false);
    // Una entrada que no está (se quitó del día) no suma nada.
    expect(totalElegidoDelCupo(reducirArmarPromo(estado, { tipo: "incrementar", seccionCartaId: "c-plato", productoId: "e-mila" }), "c-plato")).toBe(0);
  });
});
