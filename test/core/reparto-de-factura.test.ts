import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { aCentavos, repartirCantidad, repartirEnteros, repartirFactura, repartirMatriz, type RenglonARepartir } from "@/core/compras/reparto-de-factura";
import { normalizarNumeroDeComprobante } from "@/core/compras/numero-de-comprobante";

/**
 * E3a, paso 1 (docs/diseno-factura-de-proveedor-e3a-2026-10-27.md §4): el reparto exacto de una factura entre sucursales y la clave normalizada del número.
 *
 * Obligatorias del dueño (decisión 4, 2026-10-27): 3.000.000 = 2.000.000 + 1.000.000 EXACTO (con 1 y con 7 renglones) y 100 = 33,33 + 33,33 + 33,34.
 * Propiedades: cada renglón suma su importe, cada sucursal suma su peso, ninguna celda negativa, cantidades exactas por renglón.
 *
 * Mutaciones (anotadas en el commit, cada una deja rojo al menos un caso de acá): (1) que el último renglón NO se lleve el resto (todos proporcionales a los pesos fijos) → rojo
 * «2.000.000 + 1.000.000 con 7 renglones» y la propiedad de la matriz; (2) repartir cada renglón con los pesos FIJOS de las sucursales (sin presupuesto remanente) → rojo «presupuesto remanente»;
 * (3) en `repartirEnteros`, reemplazar el mayor residuo por `Math.round` de cada parte → rojo «repartirEnteros suma exacto»; (4) en modo PORCENTAJE, aceptar una suma distinta de 10000 → rojo
 * «porcentajes que no suman 100»; (5) quitar el chequeo de celda con dinero y sin cantidad → rojo «producto indivisible».
 */
const renglon = (precioTotal: number, cantidadStock = 10, decimales = 2, nombre = "Harina"): RenglonARepartir => ({ nombre, precioTotal, cantidadStock, decimales });

describe("repartirFactura: las pruebas obligatorias del dueño", () => {
  it("3.000.000 = 2.000.000 + 1.000.000 exacto con un solo renglón (importes tipeados)", () => {
    const r = repartirFactura([renglon(3_000_000, 30)], "IMPORTE", [2_000_000, 1_000_000]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.partes.map((p) => p.importe)).toEqual([2_000_000, 1_000_000]);
    expect(r.celdas[0]!.map((c) => c.precioTotal)).toEqual([2_000_000, 1_000_000]);
    expect(r.celdas[0]!.map((c) => c.cantidadStock)).toEqual([20, 10]);
    // El porcentaje es solo la intención: 6667 + 3333, y NO se usa para el dinero (daría 2.000.100 y 999.900).
    expect(r.partes.map((p) => p.porcentajeDeclaradoBp)).toEqual([6667, 3333]);
  });

  it("2.000.000 + 1.000.000 exacto con 7 renglones de importes dispares", () => {
    const precios = [1_234_567.89, 456_789.01, 99.99, 0.03, 765_432.1, 300_000, 243_110.98];
    expect(precios.reduce((s, p) => s + aCentavos(p), 0)).toBe(300_000_000);
    const r = repartirFactura(precios.map((p, i) => renglon(p, 1000, 2, `P${i}`)), "IMPORTE", [2_000_000, 1_000_000]);
    expect(r.ok, r.ok ? "" : r.mensaje).toBe(true);
    if (!r.ok) return;
    const porSucursal = [0, 1].map((j) => r.celdas.reduce((s, fila) => s + aCentavos(fila[j]!.precioTotal), 0));
    expect(porSucursal).toEqual([200_000_000, 100_000_000]);
    r.celdas.forEach((fila, i) => expect(fila.reduce((s, c) => s + aCentavos(c.precioTotal), 0)).toBe(aCentavos(precios[i]!)));
  });

  it("100 = 33,33 + 33,33 + 33,34 por porcentaje y por importe", () => {
    const porPorcentaje = repartirFactura([renglon(100, 9)], "PORCENTAJE", [33.33, 33.33, 33.34]);
    expect(porPorcentaje.ok && porPorcentaje.partes.map((p) => p.importe)).toEqual([33.33, 33.33, 33.34]);
    const porImporte = repartirFactura([renglon(100, 9)], "IMPORTE", [33.33, 33.33, 33.34]);
    expect(porImporte.ok && porImporte.partes.map((p) => p.importe)).toEqual([33.33, 33.33, 33.34]);
    expect(porImporte.ok && porImporte.partes.map((p) => p.porcentajeDeclaradoBp)).toEqual([3333, 3333, 3334]);
  });

  it("una sola sucursal (modo «cada sucursal compra lo suyo») se lleva todo", () => {
    const r = repartirFactura([renglon(150.5, 3), renglon(49.5, 1)], "PORCENTAJE", [100]);
    expect(r.ok && r.celdas).toEqual([[{ cantidadStock: 3, precioTotal: 150.5 }], [{ cantidadStock: 1, precioTotal: 49.5 }]]);
    expect(r.ok && r.partes).toEqual([{ importe: 200, porcentajeDeclaradoBp: 10000 }]);
  });
});

describe("repartirFactura: rechazos", () => {
  it("importes que no suman el total: dice cuánto falta o sobra", () => {
    expect(repartirFactura([renglon(100)], "IMPORTE", [60, 30])).toEqual({ ok: false, mensaje: "Los importes de las sucursales no llegan al total: faltan $10.00." });
    expect(repartirFactura([renglon(100)], "IMPORTE", [60, 50])).toEqual({ ok: false, mensaje: "Los importes de las sucursales pasan el total: sobran $10.00." });
  });
  it("porcentajes que no suman 100, o con más de dos decimales", () => {
    expect(repartirFactura([renglon(100)], "PORCENTAJE", [50, 49.99])).toMatchObject({ ok: false, mensaje: expect.stringContaining("suman 99.99 %") });
    expect(repartirFactura([renglon(100)], "PORCENTAJE", [50.001, 49.999])).toMatchObject({ ok: false, mensaje: expect.stringContaining("dos decimales") });
  });
  it("total 0 con importes, valores en cero o negativos, sin renglones o sin sucursales", () => {
    expect(repartirFactura([renglon(0)], "IMPORTE", [1])).toMatchObject({ ok: false });
    expect(repartirFactura([renglon(100)], "IMPORTE", [100, 0])).toMatchObject({ ok: false });
    expect(repartirFactura([], "IMPORTE", [100])).toMatchObject({ ok: false });
    expect(repartirFactura([renglon(100)], "IMPORTE", [])).toMatchObject({ ok: false });
  });
  it("producto indivisible: 1 unidad entera en tres sucursales se rechaza nombrando el producto (D11)", () => {
    const r = repartirFactura([renglon(90, 1, 0, "Bolsa de harina 25 kg")], "PORCENTAJE", [33.33, 33.33, 33.34]);
    expect(r).toMatchObject({ ok: false, mensaje: expect.stringContaining("«Bolsa de harina 25 kg» no se puede partir") });
  });
  it("tres unidades enteras en tres sucursales sí se reparten (1, 1, 1)", () => {
    const r = repartirFactura([renglon(90, 3, 0)], "PORCENTAJE", [33.33, 33.33, 33.34]);
    expect(r.ok && r.celdas[0]!.map((c) => c.cantidadStock)).toEqual([1, 1, 1]);
  });
  it("presupuesto remanente: seis renglones de $0,01 y uno de $0,04 al 50 % no dejan celdas negativas y cada sucursal suma $0,05", () => {
    const r = repartirFactura([...Array.from({ length: 6 }, () => renglon(0.01, 1, 0)), renglon(0.04, 4, 0)], "PORCENTAJE", [50, 50]);
    expect(r.ok, r.ok ? "" : r.mensaje).toBe(true);
    if (!r.ok) return;
    expect(r.celdas.flat().every((c) => c.precioTotal >= 0)).toBe(true);
    expect([0, 1].map((j) => r.celdas.reduce((s, fila) => s + aCentavos(fila[j]!.precioTotal), 0))).toEqual([5, 5]);
  });
  it("un renglón bonificado ($0) reparte su cantidad con los pesos de las sucursales", () => {
    const r = repartirFactura([renglon(100, 10), renglon(0, 4)], "IMPORTE", [75, 25]);
    expect(r.ok && r.celdas[1]!.map((c) => c.cantidadStock)).toEqual([3, 1]);
  });
});

describe("propiedades", () => {
  it("repartirEnteros suma exacto, sin negativos", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10 ** 12 }), fc.array(fc.integer({ min: 0, max: 10 ** 9 }), { minLength: 1, maxLength: 8 }), (total, pesos) => {
        const partes = repartirEnteros(total, pesos);
        expect(partes.reduce((s, v) => s + v, 0)).toBe(total);
        expect(partes.every((v) => v >= 0 && Number.isInteger(v))).toBe(true);
      })
    );
  });

  it("matriz: cada renglón suma su importe, cada sucursal suma exacto lo suyo, sin celdas negativas", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 10 ** 10 }), { minLength: 1, maxLength: 30 }),
        fc.array(fc.integer({ min: 1, max: 100 }), { minLength: 1, maxLength: 6 }),
        (renglones, pesos) => {
          const total = renglones.reduce((s, v) => s + v, 0);
          const presupuestos = repartirEnteros(total, pesos);
          const m = repartirMatriz(renglones, presupuestos);
          m.forEach((fila, i) => expect(fila.reduce((s, v) => s + v, 0)).toBe(renglones[i]));
          presupuestos.forEach((p, j) => expect(m.reduce((s, fila) => s + fila[j]!, 0)).toBe(p));
          expect(m.flat().every((v) => v >= 0)).toBe(true);
        }
      )
    );
  });

  it("repartirCantidad: suma exacta en pasos de la unidad", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10 ** 8 }), fc.integer({ min: 0, max: 4 }), fc.array(fc.integer({ min: 1, max: 1000 }), { minLength: 1, maxLength: 6 }), (pasos, decimales, pesos) => {
        const cantidad = pasos / 10 ** decimales;
        const partes = repartirCantidad(cantidad, pesos, decimales);
        expect(partes.reduce((s, v) => s + Math.round(v * 10 ** decimales), 0)).toBe(Math.round(cantidad * 10 ** decimales));
      })
    );
  });
});

describe("normalizarNumeroDeComprobante", () => {
  it.each([
    ["0001-00001234", "1-1234"],
    ["1-1234", "1-1234"],
    ["0001 1234", "1-1234"],
    ["1/1234", "1-1234"],
    ["  00001234 ", "1234"],
    ["A-0001-00000077", "A:1-77"],
    ["a 1-77", "A:1-77"],
    ["B0001-00000077", "B:1-77"],
    ["0000-0000", "0-0"],
    ["Remito sn", "REMITOSN"],
    ["1-2-3", "1-2-3"],
  ])("%s → %s", (entrada, esperado) => expect(normalizarNumeroDeComprobante(entrada)).toBe(esperado));
  it("dos letras distintas no chocan", () => expect(normalizarNumeroDeComprobante("A-1-77")).not.toBe(normalizarNumeroDeComprobante("B-1-77")));
});
