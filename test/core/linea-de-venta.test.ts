import { describe, expect, it } from "vitest";
import {
  leerCantidadVendida,
  MENSAJE_PRODUCTO_NO_EXISTE,
  mensajeMateriaPrimaNoDisponible,
  mensajeNoDisponibleEnSucursal,
  pedidoDeIngrediente,
  rechazoDelProductoVendido,
  revisarMateriaPrima,
} from "../../src/core/movimientos/linea-de-venta";

/**
 * Reglas puras de la línea de venta (Hito 5, 5.1-3): sin base. Los TEXTOS se fijan byte a byte — son los que ve quien vende y los que registran los goldens de la venta
 * (`caracterizacion/venta-matriz*.golden.txt`) —, y el ORDEN en que gana un rechazo cuando fallan dos cosas a la vez (el tipo antes que el paso).
 */

describe("leerCantidadVendida", () => {
  it("la cantidad ausente, nula o cero saltea la línea (también −0)", () => {
    for (const c of [undefined, null, 0, -0]) expect(leerCantidadVendida(c)).toEqual({ tipo: "saltear" });
  });

  it("lo que no es un número finito y no negativo es un error con su texto, no un salto", () => {
    const invalida = { tipo: "invalida", mensaje: "La cantidad vendida no es un número válido." };
    for (const c of [-1, -0.01, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, "1", "", {}, [], true]) expect(leerCantidadVendida(c)).toEqual(invalida);
  });

  it("un número finito positivo es válido y se devuelve tal cual", () => {
    expect(leerCantidadVendida(1)).toEqual({ tipo: "valida", cantidad: 1 });
    expect(leerCantidadVendida(0.25)).toEqual({ tipo: "valida", cantidad: 0.25 });
    expect(leerCantidadVendida(1e-9)).toEqual({ tipo: "valida", cantidad: 1e-9 });
  });
});

describe("los mensajes de producto", () => {
  it("el producto inexistente", () => {
    expect(MENSAJE_PRODUCTO_NO_EXISTE).toBe("El producto no existe.");
  });

  it("no disponible en la sucursal (con las comillas angulares)", () => {
    expect(mensajeNoDisponibleEnSucursal("Pizza", "Central")).toBe("«Pizza» no está disponible en «Central».");
  });
});

describe("rechazoDelProductoVendido", () => {
  it("un PV sin paso de venta se puede vender en cualquier cantidad", () => {
    expect(rechazoDelProductoVendido({ nombre: "Pizza", tipo: "PV", pasoVenta: null }, 0.3)).toBeNull();
  });

  it("un PV con paso: un múltiplo exacto se puede vender; si no, el texto del paso con coma decimal", () => {
    expect(rechazoDelProductoVendido({ nombre: "Pizza", tipo: "PV", pasoVenta: 0.5 }, 1.5)).toBeNull();
    expect(rechazoDelProductoVendido({ nombre: "Pizza", tipo: "PV", pasoVenta: 0.5 }, 0.3)).toBe('"Pizza": Se vende de a 0,5: la cantidad tiene que ser un múltiplo exacto.');
  });

  it("lo que no es un PV se rechaza con el texto del tipo", () => {
    expect(rechazoDelProductoVendido({ nombre: "Harina", tipo: "MP", pasoVenta: null }, 1)).toBe(
      '"Harina" no está habilitado para venta: solo se puede vender un PV (vinculado por receta a la materia prima que consume).'
    );
  });

  it("si falla el tipo y además el paso, gana el TIPO", () => {
    expect(rechazoDelProductoVendido({ nombre: "Harina", tipo: "MP", pasoVenta: 0.5 }, 0.3)).toBe(
      '"Harina" no está habilitado para venta: solo se puede vender un PV (vinculado por receta a la materia prima que consume).'
    );
  });
});

describe("la materia prima de una receta", () => {
  it("una MP existente se devuelve tal cual", () => {
    const harina = { tipo: "MP", nombre: "Harina" };
    expect(revisarMateriaPrima(harina, "Pizza")).toEqual({ ok: true, materiaPrima: harina });
    expect((revisarMateriaPrima(harina, "Pizza") as { materiaPrima: unknown }).materiaPrima).toBe(harina);
  });

  it("una que no existe o no es MP se rechaza con el texto que nombra al PV (no al ingrediente)", () => {
    const rechazo = { ok: false, mensaje: 'La materia prima de la receta de "Pizza" no está marcada como MP.' };
    expect(revisarMateriaPrima(null, "Pizza")).toEqual(rechazo);
    expect(revisarMateriaPrima(undefined, "Pizza")).toEqual(rechazo);
    expect(revisarMateriaPrima({ tipo: "PV", nombre: "Salsa" }, "Pizza")).toEqual(rechazo);
  });

  it("el texto de la MP no disponible en la sucursal", () => {
    expect(mensajeMateriaPrimaNoDisponible("Pizza", "Harina", "Central")).toBe("La receta de «Pizza» usa «Harina», que no está disponible en «Central»: activala acá o cambiá la receta.");
  });
});

describe("pedidoDeIngrediente (ejemplos; las propiedades están en linea-de-venta.propiedades.test.ts)", () => {
  const ing = { insumoProductoId: "mp-1", cantidad: 0.5, mermaPorcentaje: 10, rendimientosLocales: [], insumoSustitutoIds: ["ins-1"] };

  it("la cantidad vendida por el rendimiento central y su merma", () => {
    expect(pedidoDeIngrediente(2, ing, "u-1", "suc-a")).toEqual({ productoId: "mp-1", cantidad: 2 * 0.5 * (1 + 10 / 100), insumoSustitutoIds: ["ins-1"], unidadStockId: "u-1" });
  });

  it("la calibración de ESTA sucursal gana sobre la central; la de otra sucursal no cuenta", () => {
    const calibrado = { ...ing, rendimientosLocales: [{ sucursalId: "suc-a", cantidad: 0.4, mermaPorcentaje: null }, { sucursalId: "suc-b", cantidad: 9, mermaPorcentaje: 50 }] };
    expect(pedidoDeIngrediente(1, calibrado, "u-1", "suc-a").cantidad).toBe(1 * 0.4 * (1 + 10 / 100));
    expect(pedidoDeIngrediente(1, calibrado, "u-1", "suc-c").cantidad).toBe(1 * 0.5 * (1 + 10 / 100));
  });
});
