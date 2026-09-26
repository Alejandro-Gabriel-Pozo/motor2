import { describe, expect, it } from "vitest";
import {
  estadoInicialListaPorAgregar,
  estaEnListaPorAgregar,
  itemsDeListaPorAgregar,
  listaPorAgregarLlena,
  puedeConfirmarListaPorAgregar,
  reducirListaPorAgregar,
  type AccionListaPorAgregar,
  type EstadoListaPorAgregar,
} from "../../src/core/pos/agregar-lista-estado";
import { CANTIDAD_MAXIMA_POR_ITEM, MAXIMO_ITEMS_POR_AGREGADO } from "../../src/core/pos/cantidad-pedido";

/**
 * Lista «Por agregar» del POS (docs/plan-pos-agregar-varios-2026-09-26.md): reductor puro, sin servidor ni DOM — acumular
 * repetidos, el tope de productos DISTINTOS, la conversión con `interpretarNumero` y la normalización con `validarCantidadPedido`
 * (la MISMA función que usa el servidor al confirmar).
 */

const aplicar = (estado: EstadoListaPorAgregar, ...acciones: AccionListaPorAgregar[]) => acciones.reduce(reducirListaPorAgregar, estado);
const sumar = (productoId: string): AccionListaPorAgregar => ({ tipo: "sumarProducto", productoId, tope: MAXIMO_ITEMS_POR_AGREGADO });

describe("estadoInicialListaPorAgregar", () => {
  it("arranca vacía", () => {
    expect(estadoInicialListaPorAgregar()).toEqual({ lineas: [] });
  });
});

describe("sumarProducto", () => {
  it("un producto nuevo abre una línea con cantidad 1", () => {
    const e = aplicar(estadoInicialListaPorAgregar(), sumar("p-milanesa"));
    expect(e.lineas).toEqual([{ productoId: "p-milanesa", cantidad: 1, cantidadTexto: "1", error: null }]);
  });

  it("sumar el mismo producto de nuevo ACUMULA en la misma línea, nunca abre una segunda", () => {
    const e = aplicar(estadoInicialListaPorAgregar(), sumar("p-milanesa"), sumar("p-flan"), sumar("p-milanesa"), sumar("p-milanesa"));
    expect(e.lineas).toHaveLength(2);
    expect(e.lineas.find((l) => l.productoId === "p-milanesa")).toMatchObject({ cantidad: 3, cantidadTexto: "3" });
    expect(e.lineas.find((l) => l.productoId === "p-flan")).toMatchObject({ cantidad: 1 });
  });

  it("acumular respeta el tope de CANTIDAD_MAXIMA_POR_ITEM (999): no sigue subiendo de ahí", () => {
    let e = aplicar(estadoInicialListaPorAgregar(), sumar("p-x"));
    e = { lineas: [{ ...e.lineas[0], cantidad: CANTIDAD_MAXIMA_POR_ITEM, cantidadTexto: String(CANTIDAD_MAXIMA_POR_ITEM) }] };
    e = aplicar(e, sumar("p-x"));
    expect(e.lineas[0].cantidad).toBe(CANTIDAD_MAXIMA_POR_ITEM);
  });

  it("tope de productos DISTINTOS: un producto NUEVO en el tope no abre línea; uno ya existente sigue acumulando igual", () => {
    let e = estadoInicialListaPorAgregar();
    for (let i = 0; i < MAXIMO_ITEMS_POR_AGREGADO; i++) e = aplicar(e, sumar(`p-${i}`));
    expect(e.lineas).toHaveLength(MAXIMO_ITEMS_POR_AGREGADO);
    expect(listaPorAgregarLlena(e, MAXIMO_ITEMS_POR_AGREGADO)).toBe(true);

    const conNuevo = aplicar(e, sumar("p-nueva-51"));
    expect(conNuevo.lineas).toHaveLength(MAXIMO_ITEMS_POR_AGREGADO); // no se agregó
    const conRepetido = aplicar(e, sumar("p-0"));
    expect(conRepetido.lineas).toHaveLength(MAXIMO_ITEMS_POR_AGREGADO);
    expect(conRepetido.lineas.find((l) => l.productoId === "p-0")?.cantidad).toBe(2); // el repetido SÍ acumula
  });
});

describe("incrementar / decrementar (botones −/+ de una línea)", () => {
  it("incrementar suma 1; decrementar resta 1", () => {
    let e = aplicar(estadoInicialListaPorAgregar(), sumar("p-x"), { tipo: "incrementar", productoId: "p-x" });
    expect(e.lineas[0].cantidad).toBe(2);
    e = aplicar(e, { tipo: "decrementar", productoId: "p-x" });
    expect(e.lineas[0].cantidad).toBe(1);
  });

  it("decrementar a 0 quita la línea", () => {
    const e = aplicar(estadoInicialListaPorAgregar(), sumar("p-x"), { tipo: "decrementar", productoId: "p-x" });
    expect(e.lineas).toEqual([]);
  });
});

describe("cambiarCantidadTexto (conversión con interpretarNumero)", () => {
  it("un texto válido (con coma decimal) actualiza el texto y la cantidad candidata para el subtotal", () => {
    const e = aplicar(estadoInicialListaPorAgregar(), sumar("p-x"), { tipo: "cambiarCantidadTexto", productoId: "p-x", texto: "2,5" });
    expect(e.lineas[0]).toMatchObject({ cantidadTexto: "2,5", cantidad: 2.5 });
  });

  it("un texto a medio tipear (no numérico todavía) no rompe la cantidad candidata: se conserva la anterior", () => {
    const e = aplicar(estadoInicialListaPorAgregar(), sumar("p-x"), { tipo: "cambiarCantidadTexto", productoId: "p-x", texto: "," });
    expect(e.lineas[0]).toMatchObject({ cantidadTexto: ",", cantidad: 1 });
  });
});

describe("normalizarCantidad (misma función que el servidor, validarCantidadPedido)", () => {
  it("una cantidad que redondea (unidad entera, decimales=0): se ve el valor que se va a guardar, no el tipeado", () => {
    const e = aplicar(estadoInicialListaPorAgregar(), sumar("p-x"), { tipo: "cambiarCantidadTexto", productoId: "p-x", texto: "1,4" }, { tipo: "normalizarCantidad", productoId: "p-x", decimales: 0 });
    expect(e.lineas[0]).toEqual({ productoId: "p-x", cantidad: 1, cantidadTexto: "1", error: null });
  });

  it("una unidad con decimales (ej. kg, 2 decimales) normaliza a esos decimales", () => {
    const e = aplicar(estadoInicialListaPorAgregar(), sumar("p-x"), { tipo: "cambiarCantidadTexto", productoId: "p-x", texto: "1,256" }, { tipo: "normalizarCantidad", productoId: "p-x", decimales: 2 });
    expect(e.lineas[0]).toMatchObject({ cantidad: 1.26, cantidadTexto: "1.26" });
  });

  it("una cantidad inválida (cero, negativa, formato roto o mayor que el tope) queda con el mensaje del servidor, sin confirmar", () => {
    const base = aplicar(estadoInicialListaPorAgregar(), sumar("p-x"));
    const vacio = aplicar(base, { tipo: "cambiarCantidadTexto", productoId: "p-x", texto: "" }, { tipo: "normalizarCantidad", productoId: "p-x", decimales: 0 });
    expect(vacio.lineas[0].error).toBe("La cantidad tiene que ser un número mayor que cero.");
    const roto = aplicar(base, { tipo: "cambiarCantidadTexto", productoId: "p-x", texto: "1-2-3" }, { tipo: "normalizarCantidad", productoId: "p-x", decimales: 0 });
    expect(roto.lineas[0].error).toBeTruthy();
    const excedida = aplicar(base, { tipo: "cambiarCantidadTexto", productoId: "p-x", texto: "1000" }, { tipo: "normalizarCantidad", productoId: "p-x", decimales: 0 });
    expect(excedida.lineas[0].error).toBe(`La cantidad no puede superar ${CANTIDAD_MAXIMA_POR_ITEM}.`);
  });
});

describe("quitarLinea / vaciar", () => {
  it("quitarLinea sacar una línea puntual", () => {
    const e = aplicar(estadoInicialListaPorAgregar(), sumar("p-x"), sumar("p-y"), { tipo: "quitarLinea", productoId: "p-x" });
    expect(e.lineas.map((l) => l.productoId)).toEqual(["p-y"]);
  });

  it("vaciar deja la lista en el estado inicial", () => {
    const e = aplicar(estadoInicialListaPorAgregar(), sumar("p-x"), sumar("p-y"), { tipo: "vaciar" });
    expect(e).toEqual(estadoInicialListaPorAgregar());
  });
});

describe("selectores", () => {
  it("estaEnListaPorAgregar", () => {
    const e = aplicar(estadoInicialListaPorAgregar(), sumar("p-x"));
    expect(estaEnListaPorAgregar(e, "p-x")).toBe(true);
    expect(estaEnListaPorAgregar(e, "p-y")).toBe(false);
  });

  it("puedeConfirmarListaPorAgregar: falso si está vacía o si alguna línea tiene error", () => {
    expect(puedeConfirmarListaPorAgregar(estadoInicialListaPorAgregar())).toBe(false);
    const ok = aplicar(estadoInicialListaPorAgregar(), sumar("p-x"));
    expect(puedeConfirmarListaPorAgregar(ok)).toBe(true);
    const conError = aplicar(ok, { tipo: "cambiarCantidadTexto", productoId: "p-x", texto: "" }, { tipo: "normalizarCantidad", productoId: "p-x", decimales: 0 });
    expect(puedeConfirmarListaPorAgregar(conError)).toBe(false);
  });

  it("itemsDeListaPorAgregar: un {productoId, cantidad} por línea, en el orden en que se agregaron", () => {
    const e = aplicar(estadoInicialListaPorAgregar(), sumar("p-milanesa"), sumar("p-flan"), sumar("p-milanesa"));
    expect(itemsDeListaPorAgregar(e)).toEqual([
      { productoId: "p-milanesa", cantidad: 2 },
      { productoId: "p-flan", cantidad: 1 },
    ]);
  });
});
