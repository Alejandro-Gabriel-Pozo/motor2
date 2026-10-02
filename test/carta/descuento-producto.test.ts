import { describe, expect, it } from "vitest";
import { aplicarDescuentoDeProducto, descuentosVigentes, precioCobradoConDescuentos } from "../../src/core/carta/descuento-producto";

/**
 * Producto con descuento (Fase 2): el cálculo puro. Una sola definición para la carta, el selector, el alta a la cuenta, el cierre, la boleta y el
 * reporte — por eso se fija acá con los redondeos y el piso, no en cada pantalla.
 */
describe("descuentosVigentes (R1: sin la capacidad precio_local no rige ningún descuento)", () => {
  const configurados = new Map([["a", 15], ["b", 5]]);

  it("con la capacidad prendida rigen todos los configurados", () => {
    expect([...descuentosVigentes(configurados, true)]).toEqual([["a", 15], ["b", 5]]);
  });

  it("con la capacidad apagada no rige ninguno", () => {
    expect(descuentosVigentes(configurados, false).size).toBe(0);
  });

  it("no muta ni comparte el mapa configurado", () => {
    const vigentes = descuentosVigentes(configurados, true);
    vigentes.delete("a");
    expect(configurados.get("a")).toBe(15);
  });
});

describe("aplicarDescuentoDeProducto", () => {
  it("sin porcentaje (null, undefined o 0): precio de lista, sin descuento", () => {
    for (const p of [null, undefined, 0]) {
      expect(aplicarDescuentoDeProducto(1000, p)).toEqual({ precio: 1000, precioLista: null, porcentaje: null });
    }
  });

  it("aplica el porcentaje y devuelve el precio de lista para tacharlo", () => {
    expect(aplicarDescuentoDeProducto(1000, 15)).toEqual({ precio: 850, precioLista: 1000, porcentaje: 15 });
  });

  it("redondea a centavos hacia arriba en el medio: 1234,55 al 15 % → 1049,37 (1049,3675)", () => {
    const r = aplicarDescuentoDeProducto(1234.55, 15);
    expect(r.precio).toBe(1049.37);
    expect(r.precioLista).toBe(1234.55);
  });

  it("un descuento enorme no baja de $0,01", () => {
    expect(aplicarDescuentoDeProducto(0.5, 99.99).precio).toBe(0.01);
  });

  it("un descuento que no cambia el precio (precio ya en el piso) no cuenta como descuento", () => {
    expect(aplicarDescuentoDeProducto(0.01, 50)).toEqual({ precio: 0.01, precioLista: null, porcentaje: null });
  });
});

describe("precioCobradoConDescuentos (rige SOLO EL MAYOR, nunca en cascada)", () => {
  it("sin ningún descuento: el precio tal cual, sin origen", () => {
    expect(precioCobradoConDescuentos(1000, null, null)).toEqual({ precio: 1000, precioLista: null, origen: null });
    expect(precioCobradoConDescuentos(1000, null, 0)).toEqual({ precio: 1000, precioLista: null, origen: null });
  });

  it("solo descuento de producto (el precio congelado ya viene descontado): se cobra ese, origen producto", () => {
    expect(precioCobradoConDescuentos(850, 1000, null)).toEqual({ precio: 850, precioLista: 1000, origen: "producto" });
  });

  it("solo descuento de cliente sobre un suelto sin descuento de producto: lo aplica el cliente", () => {
    expect(precioCobradoConDescuentos(1000, null, 20)).toEqual({ precio: 800, precioLista: 1000, origen: "cliente" });
  });

  it("el del cliente es MAYOR (20 % contra 15 %): gana el cliente, calculado sobre la lista — no sobre el ya descontado", () => {
    expect(precioCobradoConDescuentos(850, 1000, 20)).toEqual({ precio: 800, precioLista: 1000, origen: "cliente" });
  });

  it("el del producto es MAYOR (15 % contra 10 %): gana el producto, el cliente no suma", () => {
    expect(precioCobradoConDescuentos(850, 1000, 10)).toEqual({ precio: 850, precioLista: 1000, origen: "producto" });
  });

  it("empate (15 % y 15 %): gana el de producto", () => {
    expect(precioCobradoConDescuentos(850, 1000, 15)).toEqual({ precio: 850, precioLista: 1000, origen: "producto" });
  });

  it("nunca es la cascada: 15 % + 20 % daría 680, y lo cobrado es 800", () => {
    expect(precioCobradoConDescuentos(850, 1000, 20).precio).not.toBe(680);
  });

  it("respeta el piso de $0,01 con el descuento del cliente", () => {
    expect(precioCobradoConDescuentos(0.5, null, 99.99).precio).toBe(0.01);
  });
});
