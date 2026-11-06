import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { avisoDeVentasSinDato, calcularVentasDelPeriodo } from "@/core/reportes/public";
import type { ItemPeriodo } from "@/core/reportes/periodo-tipos";

/**
 * Lote 1b, hallazgo C (decisión del dueño, 2026-11-06, CONFIRMADA): las ventas quedan CONGELADAS. Una venta con importe $0 significa «sin dato» y nada más: no se revalúa al precio de lista de hoy, no suma
 * al total facturado y se informa aparte (cuántas son) para que el reporte diga «sin dato», nunca un número inventado. Coherente con el margen Real, que ya las excluye.
 */
function venta(base: Partial<ItemPeriodo> & Pick<ItemPeriodo, "productoId">): ItemPeriodo {
  return {
    proceso: "VENTA",
    fecha: new Date("2026-03-01T12:00:00Z"),
    productoNombre: `Producto ${base.productoId}`,
    productoCodigo: base.productoId,
    detalle: "",
    cantidad: 1,
    loteVencimiento: null,
    proveedorNombre: "Prov",
    proveedorId: "prov",
    nroFactura: null,
    seccionId: "sec",
    seccionNombre: "Sec",
    idMovimiento: `m-${Math.random()}`,
    idOperacion: "op",
    precioTotal: 0,
    precioPorUnidadStock: 0,
    costoUnitarioVenta: null,
    anulada: false,
    ...base,
  } as ItemPeriodo;
}

describe("calcularVentasDelPeriodo: importe $0 = sin dato, nunca se revalúa", () => {
  it("una venta con importe real se toma tal cual", () => {
    const r = calcularVentasDelPeriodo([venta({ productoId: "a", cantidad: 2, precioTotal: 200, precioPorUnidadStock: 100 })]);
    expect(r.totalFacturado).toBe(200);
    expect(r.porProducto).toEqual([{ productoId: "a", producto: "Producto a", cantidad: 2, importe: 200, precioUnitario: 100 }]);
    expect(r.lineasSinDato).toBe(0);
    expect(r.aviso).toMatch(/real/i);
  });

  it("una venta con importe $0 queda fuera del total y de las filas, y se cuenta como sin dato", () => {
    const r = calcularVentasDelPeriodo([venta({ productoId: "a", cantidad: 2, precioTotal: 200, precioPorUnidadStock: 100 }), venta({ productoId: "a", cantidad: 5 }), venta({ productoId: "b", cantidad: 1 })]);
    expect(r.totalFacturado).toBe(200);
    expect(r.porProducto.map((f) => [f.productoId, f.cantidad, f.importe])).toEqual([["a", 2, 200]]);
    expect(r.lineasSinDato).toBe(2);
    expect(r.aviso).toMatch(/sin dato/i);
    expect(r.aviso).not.toMatch(/vigente/i);
  });

  it("una venta anulada no cuenta como sin dato", () => {
    const r = calcularVentasDelPeriodo([venta({ productoId: "a", anulada: true })]);
    expect(r.lineasSinDato).toBe(0);
    expect(r.totalFacturado).toBe(0);
  });

  it("propiedad: el total y las filas no dependen de nada que no sea el importe guardado (las líneas $0 no cambian nada salvo el contador)", () => {
    const importe = fc.integer({ min: 1, max: 5_000_000 }).map((c) => c / 100);
    fc.assert(
      fc.property(
        fc.array(fc.record({ importe, cantidad: fc.integer({ min: 1, max: 5000 }).map((m) => m / 1000), producto: fc.constantFrom("p1", "p2", "p3") }), { minLength: 0, maxLength: 60 }),
        fc.array(fc.record({ cantidad: fc.integer({ min: 1, max: 5000 }).map((m) => m / 1000), producto: fc.constantFrom("p1", "p2", "p3", "p4") }), { maxLength: 30 }),
        (reales, ceros) => {
          const itemsReales = reales.map((l) => venta({ productoId: l.producto, cantidad: l.cantidad, precioTotal: l.importe, precioPorUnidadStock: l.importe / l.cantidad }));
          const itemsCeros = ceros.map((l) => venta({ productoId: l.producto, cantidad: l.cantidad }));
          const solo = calcularVentasDelPeriodo(itemsReales);
          const mezcla = calcularVentasDelPeriodo([...itemsReales, ...itemsCeros]);
          expect(mezcla.totalFacturado).toBe(solo.totalFacturado);
          expect(mezcla.porProducto).toEqual(solo.porProducto);
          expect(mezcla.lineasSinDato).toBe(ceros.length);
        }
      ),
      { numRuns: 300 }
    );
  });
});

describe("avisoDeVentasSinDato: el mismo texto en todos los reportes (Consolidado incluido)", () => {
  it("sin ventas $0 no dice nada", () => expect(avisoDeVentasSinDato(0)).toBe(""));
  it("singular y plural", () => {
    expect(avisoDeVentasSinDato(1)).toBe("1 venta sin importe registrado queda FUERA de estos totales (sin dato): no se estiman al precio de hoy.");
    expect(avisoDeVentasSinDato(3)).toBe("3 ventas sin importe registrado quedan FUERA de estos totales (sin dato): no se estiman al precio de hoy.");
  });
  it("el aviso de calcularVentasDelPeriodo es ese mismo texto", () => {
    const r = calcularVentasDelPeriodo([venta({ productoId: "a" }), venta({ productoId: "b" })]);
    expect(r.aviso).toBe(avisoDeVentasSinDato(2));
  });
});
