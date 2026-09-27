import { describe, expect, it } from "vitest";
import {
  cantidadElegida,
  eleccionParaAgregar,
  estadoInicialArmarPromo,
  puedeConfirmarArmarPromo,
  reducirArmarPromo,
  totalElegidoDelCupo,
  type AccionArmarPromo,
  type EstadoArmarPromo,
} from "../../src/core/pos/armar-promo-estado";
import type { EntradaPromoSelectorCarta, ProductoPedible } from "../../src/core/pos/selector-carta";

/** Reductor puro del diálogo "Armar promo" (Task #16, docs/plan-promo-combo-2026-09-26.md, paso 11): sin DOM. */

const pedible = (productoId: string): ProductoPedible => ({ productoId, codigo: productoId, nombre: productoId, precio: 1000, decimales: 0, pasoVenta: null, tieneStockReal: false });

const entrada: EntradaPromoSelectorCarta = {
  tipo: "promo",
  promoCartaId: "promo-1",
  titulo: "Menú del día",
  precio: 10000,
  cupos: [
    { seccionCartaId: "s-entradas", nombreSeccion: "Entradas", cantidadMinima: 1, cantidadMaximaCupo: 2, elegibles: [pedible("empanada"), pedible("provoleta")] },
    { seccionCartaId: "s-postres", nombreSeccion: "Postres", cantidadMinima: 0, cantidadMaximaCupo: 1, elegibles: [pedible("flan")] },
  ],
};

const aplicar = (estado: EstadoArmarPromo, ...acciones: AccionArmarPromo[]) => acciones.reduce(reducirArmarPromo, estado);

describe("estadoInicialArmarPromo", () => {
  it("arranca con los dos cupos en cero, y no cumple el mínimo de Entradas todavía", () => {
    const inicial = estadoInicialArmarPromo(entrada);
    expect(totalElegidoDelCupo(inicial, "s-entradas")).toBe(0);
    expect(totalElegidoDelCupo(inicial, "s-postres")).toBe(0);
    expect(puedeConfirmarArmarPromo(inicial)).toBe(false); // Entradas: mínimo 1, todavía 0
  });
});

describe("reducirArmarPromo — incrementar/decrementar (D1)", () => {
  it("incrementar suma una unidad al producto elegido, dentro del mismo cupo", () => {
    const estado = aplicar(estadoInicialArmarPromo(entrada), { tipo: "incrementar", seccionCartaId: "s-entradas", productoId: "empanada" });
    expect(cantidadElegida(estado, "s-entradas", "empanada")).toBe(1);
    expect(totalElegidoDelCupo(estado, "s-entradas")).toBe(1);
  });

  it("nunca pasa del máximo del cupo (D1), aunque se reparta entre dos productos distintos", () => {
    let estado = estadoInicialArmarPromo(entrada);
    estado = aplicar(estado, { tipo: "incrementar", seccionCartaId: "s-entradas", productoId: "empanada" }, { tipo: "incrementar", seccionCartaId: "s-entradas", productoId: "empanada" });
    expect(totalElegidoDelCupo(estado, "s-entradas")).toBe(2); // ya en el máximo
    const sinCambio = reducirArmarPromo(estado, { tipo: "incrementar", seccionCartaId: "s-entradas", productoId: "provoleta" });
    expect(totalElegidoDelCupo(sinCambio, "s-entradas")).toBe(2); // el + de otro producto tampoco lo pasa
    expect(cantidadElegida(sinCambio, "s-entradas", "provoleta")).toBe(0);
  });

  it("decrementar resta una unidad, y en cero borra la entrada (no queda en 0 explícito)", () => {
    let estado = aplicar(estadoInicialArmarPromo(entrada), { tipo: "incrementar", seccionCartaId: "s-entradas", productoId: "empanada" });
    estado = reducirArmarPromo(estado, { tipo: "decrementar", seccionCartaId: "s-entradas", productoId: "empanada" });
    expect(cantidadElegida(estado, "s-entradas", "empanada")).toBe(0);
    expect(eleccionParaAgregar(estado).find((e) => e.seccionCartaId === "s-entradas")?.elegidos).toEqual([]);
  });

  it("decrementar por debajo de cero no hace nada", () => {
    const estado = reducirArmarPromo(estadoInicialArmarPromo(entrada), { tipo: "decrementar", seccionCartaId: "s-entradas", productoId: "empanada" });
    expect(totalElegidoDelCupo(estado, "s-entradas")).toBe(0);
  });

  it("una acción de un cupo/sección que no existe se ignora, sin romper nada", () => {
    const inicial = estadoInicialArmarPromo(entrada);
    const estado = reducirArmarPromo(inicial, { tipo: "incrementar", seccionCartaId: "no-existe", productoId: "x" });
    expect(estado).toEqual(inicial);
  });

  it("los dos cupos son independientes entre sí", () => {
    let estado = estadoInicialArmarPromo(entrada);
    estado = aplicar(estado, { tipo: "incrementar", seccionCartaId: "s-entradas", productoId: "empanada" }, { tipo: "incrementar", seccionCartaId: "s-postres", productoId: "flan" });
    expect(totalElegidoDelCupo(estado, "s-entradas")).toBe(1);
    expect(totalElegidoDelCupo(estado, "s-postres")).toBe(1);
  });
});

describe("puedeConfirmarArmarPromo (D1: todos los cupos entre mínimo y máximo)", () => {
  it("con Entradas en su mínimo (1) y Postres opcional (mínimo 0) sin elegir: ya se puede confirmar", () => {
    const estado = aplicar(estadoInicialArmarPromo(entrada), { tipo: "incrementar", seccionCartaId: "s-entradas", productoId: "empanada" });
    expect(puedeConfirmarArmarPromo(estado)).toBe(true);
  });

  it("por debajo del mínimo de un cupo obligatorio: no se puede confirmar", () => {
    expect(puedeConfirmarArmarPromo(estadoInicialArmarPromo(entrada))).toBe(false);
  });
});

describe("eleccionParaAgregar", () => {
  it("arma la elección lista para agregarItems, un cupo por sección, con lo elegido de cada uno", () => {
    let estado = estadoInicialArmarPromo(entrada);
    estado = aplicar(
      estado,
      { tipo: "incrementar", seccionCartaId: "s-entradas", productoId: "empanada" },
      { tipo: "incrementar", seccionCartaId: "s-entradas", productoId: "provoleta" },
      { tipo: "incrementar", seccionCartaId: "s-postres", productoId: "flan" }
    );
    const entradas = eleccionParaAgregar(estado).find((e) => e.seccionCartaId === "s-entradas")!.elegidos;
    expect(entradas.sort((a, b) => a.productoId.localeCompare(b.productoId))).toEqual([
      { productoId: "empanada", cantidad: 1 },
      { productoId: "provoleta", cantidad: 1 },
    ]);
    expect(eleccionParaAgregar(estado).find((e) => e.seccionCartaId === "s-postres")?.elegidos).toEqual([{ productoId: "flan", cantidad: 1 }]);
  });

  it("un cupo sin nada elegido (mínimo 0, D1) da un array vacío de elegidos, no se omite el cupo", () => {
    const estado = aplicar(estadoInicialArmarPromo(entrada), { tipo: "incrementar", seccionCartaId: "s-entradas", productoId: "empanada" });
    expect(eleccionParaAgregar(estado)).toEqual([
      { seccionCartaId: "s-entradas", elegidos: [{ productoId: "empanada", cantidad: 1 }] },
      { seccionCartaId: "s-postres", elegidos: [] },
    ]);
  });
});
