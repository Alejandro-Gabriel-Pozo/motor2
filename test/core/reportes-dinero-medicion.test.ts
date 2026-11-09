import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { Decimal } from "decimal.js";
import { calcularComprasDelPeriodo } from "../../src/core/reportes/periodo-compras";
import { calcularVentasDelPeriodo } from "../../src/core/reportes/periodo-ventas";
import type { InfoProductoReporte } from "../../src/core/reportes/comun";
import type { ItemPeriodo } from "../../src/core/reportes/periodo-tipos";

/**
 * MEDICIÓN del dinero dentro de `core` (Pureza, Hito 2, trabajo 2.8; decisión del dueño 2026-10-08: «se escribe como diseño y se mide»).
 *
 * El diseño: la plata exacta vive en la base (columnas `Decimal`, el Kardex) y en `core/moneda` (multiplicar, repartir y redondear con `decimal.js`); `core/reportes` SUMA en `number` y
 * redondea UNA vez al presentar con `redondearMoneda`. Esta prueba compara los reportes que más suman (compras y ventas del período) contra el cálculo EXACTO con Decimal, sobre datos
 * realistas (importes en centavos, cantidades con hasta 3 decimales, hasta cientos de líneas), y fija el resultado de la medición:
 *  - con importes que ya vienen en centavos (lo que guarda la base en `precioTotal`) la suma en `number` redondeada a centavos es IGUAL a la exacta, siempre (la grilla de centavos es exacta
 *    hasta ~2^53 centavos y el error acumulado de sumar cientos de líneas queda varios órdenes de magnitud por debajo de medio centavo);
 *  - las ventas ya NO se estiman (decisión del dueño, 2026-11-06): una línea con importe $0 es «sin dato» y queda fuera (test/core/ventas-del-periodo-sin-dato.test.ts); antes la medición del
 *    2026-10-08 de las estimadas (cantidad × precio vigente) llevó a redondear cada línea con `importeDeLinea`.
 *    No hace falta migrar los reportes a Decimal: si en algún reporte aparecieran diferencias en importes ya en centavos, recién ahí se abre ese paso.
 * Funciones puras: sin Postgres.
 */

const centavos = fc.integer({ min: 1, max: 100_000_000 }).map((c) => c / 100); // hasta $1.000.000,00
const cantidad = fc.integer({ min: 1, max: 50_000 }).map((m) => m / 1000); // hasta 50 con 3 decimales

function item(base: Partial<ItemPeriodo> & Pick<ItemPeriodo, "proceso" | "productoId">): ItemPeriodo {
  return {
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

const productos = (precios: Record<string, number>) =>
  new Map<string, InfoProductoReporte>(Object.entries(precios).map(([id, precioVenta]) => [id, { precioVenta, esNoComestible: false } as unknown as InfoProductoReporte]));

const exactoARedondeado = (suma: Decimal) => suma.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();

describe("dinero en core/reportes, medido contra el cálculo exacto (Decimal)", () => {
  it("compras del período: con importes en centavos, el total y el de cada proveedor son IGUALES al exacto (sin diferencia alguna)", () => {
    fc.assert(
      fc.property(fc.array(fc.record({ importe: centavos, proveedor: fc.constantFrom("A", "B", "C"), producto: fc.constantFrom("p1", "p2", "p3") }), { minLength: 1, maxLength: 400 }), (lineas) => {
        const items = lineas.map((l, i) => item({ proceso: "COMPRA", productoId: l.producto, precioTotal: l.importe, proveedorNombre: l.proveedor, proveedorId: l.proveedor, idOperacion: `op${i}` }));
        const r = calcularComprasDelPeriodo(items, productos({}));
        expect(r.totalGastado).toBe(exactoARedondeado(lineas.reduce((s, l) => s.plus(new Decimal(l.importe)), new Decimal(0))));
        for (const f of r.porProveedor) {
          expect(f.importe).toBe(exactoARedondeado(lineas.filter((l) => l.proveedor === f.proveedor).reduce((s, l) => s.plus(new Decimal(l.importe)), new Decimal(0))));
        }
      }),
      { numRuns: 400 },
    );
  });

  it("ventas del período con importe REAL (precioTotal en centavos): total y por producto IGUALES al exacto", () => {
    fc.assert(
      fc.property(fc.array(fc.record({ importe: centavos, cantidad, producto: fc.constantFrom("p1", "p2", "p3") }), { minLength: 1, maxLength: 400 }), (lineas) => {
        const items = lineas.map((l) => item({ proceso: "VENTA", productoId: l.producto, cantidad: l.cantidad, precioTotal: l.importe, precioPorUnidadStock: l.importe / l.cantidad }));
        const r = calcularVentasDelPeriodo(items);
        expect(r.totalFacturado).toBe(exactoARedondeado(lineas.reduce((s, l) => s.plus(new Decimal(l.importe)), new Decimal(0))));
        for (const f of r.porProducto) {
          expect(f.importe).toBe(exactoARedondeado(lineas.filter((l) => l.producto === f.productoId).reduce((s, l) => s.plus(new Decimal(l.importe)), new Decimal(0))));
        }
      }),
      { numRuns: 400 },
    );
  });
});
