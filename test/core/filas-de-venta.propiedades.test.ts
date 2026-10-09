import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { importeDeLinea } from "../../src/core/moneda";
import { crearArrastreDeRedondeo } from "../../src/core/movimientos/arrastre-redondeo";
import { filasDeUnaVenta, type ProductoParaFilas } from "../../src/core/movimientos/filas-de-venta";
import type { VentaCalculada } from "../../src/core/movimientos/plan-de-la-venta";
import { redondearACantidadDeUnidad } from "../../src/core/movimientos/transiciones";

/**
 * Propiedades (fast-check) de `filasDeUnaVenta` (Hito 5, 5.1 bloque B2b): lo que la venta escribe en el Kardex cierra por construcción, para cualquier venta, no solo para los ejemplos.
 * - La suma de los importes de las filas VENTA es EXACTAMENTE `importeDeLinea(cantidad, precio)` (en centavos enteros), también cuando el PV sale de varios lotes.
 * - La suma de las cantidades de las filas VENTA da la cantidad vendida: la ÚLTIMA parte se lleva el resto, aunque la cantidad que declaraba difiera.
 * - Las cantidades de CONSUMO y de VENTA se escriben con signo negativo (salen del stock); la liquidación no mueve cantidad.
 * - Hay LIQUIDACION_CONSIGNACION exactamente por cada consumo de un producto de consignación.
 * - `cantidadExacta` es `null` exactamente cuando coincide con lo escrito (y, si no, es la cantidad exacta del consumo con el signo de la fila).
 */

const r4 = (n: number) => redondearACantidadDeUnidad(n, 4);
const r8 = (n: number) => redondearACantidadDeUnidad(n, 8);

const PRODUCTOS: Record<string, ProductoParaFilas> = {
  "mp-0": { nombre: "Bollo", esConsignacion: false, precioConsignacion: null, unidadStock: { decimales: 0 } },
  "mp-1": { nombre: "Harina", esConsignacion: false, precioConsignacion: null, unidadStock: { decimales: 2 } },
  "mp-2": { nombre: "Fiambre", esConsignacion: true, precioConsignacion: "12.5", unidadStock: { decimales: 3 } },
  "mp-3": { nombre: "Queso", esConsignacion: true, precioConsignacion: null, unidadStock: { decimales: 1 } },
};
const IDS = Object.keys(PRODUCTOS);

const consumoArb = fc.record({
  productoId: fc.constantFrom(...IDS),
  seccionId: fc.constantFrom("s-1", "s-2"),
  loteVencimiento: fc.constantFrom(null, new Date("2026-11-01"), new Date("2026-12-01")),
  cantidad: fc.double({ min: 0.001, max: 5, noNaN: true, noDefaultInfinity: true }),
});

/** Cantidades con la precisión del Kardex (múltiplos de 0,0001), para que la comparación de sumas sea exacta. */
const cantidadKardexArb = fc.integer({ min: 1, max: 50_000 }).map((n) => n / 10_000);

/** Una venta con 0 a 4 consumos y 0 a 4 partes propias; la cantidad vendida es la suma de las partes + un resto ≥ 0 (la última parte DECLARA otra cantidad que lo que resta). */
const ventaArb = fc
  .record({
    consumos: fc.array(consumoArb, { maxLength: 4 }),
    partes: fc.array(cantidadKardexArb, { maxLength: 4 }),
    desvioDeLaUltima: fc.integer({ min: -3, max: 3 }).map((n) => n / 1000),
    resto: cantidadKardexArb,
    precioCentavos: fc.integer({ min: 0, max: 5_000_000 }),
    costo: fc.option(fc.integer({ min: 0, max: 100_000 }).map((c) => c / 100), { nil: null }),
    lista: fc.option(fc.integer({ min: 0, max: 100_000 }).map((c) => c / 100), { nil: null }),
  })
  .map(({ consumos, partes, desvioDeLaUltima, resto, precioCentavos, costo, lista }): VentaCalculada => {
    const sumaDeLasPrevias = partes.slice(0, -1).reduce((s, p) => s + p, 0);
    // La cantidad vendida es lo de las partes previas más un resto: la última parte declara el resto con un desvío (las cantidades declaradas no tienen por qué sumar exacto).
    const cantidadVendida = r4(sumaDeLasPrevias + (partes.length ? resto : 0) || resto);
    const declaradas = partes.map((p, k) => (k === partes.length - 1 ? Math.max(0.0001, r4(resto + desvioDeLaUltima)) : p));
    return {
      productoId: "pv-1", nombre: "PV", seProduce: partes.length > 0, cantidadVendida, precioVenta: precioCentavos / 100, precioListaVenta: lista, costoUnitarioAlVender: costo, promoCuentaId: null, pedidos: [],
      seccionId: "s-1", loteVencimiento: null,
      partesPropias: partes.length ? declaradas.map((cantidad, k) => ({ productoId: "pv-1", seccionId: k % 2 ? "s-2" : "s-1", loteVencimiento: new Date(2026, 10, 1 + k), cantidad })) : undefined,
      consumos,
    };
  });

const filasDe = (venta: VentaCalculada) => filasDeUnaVenta(venta, "op-1", { detalle: undefined, productoDe: (id) => PRODUCTOS[id], arrastre: crearArrastreDeRedondeo() });
const centavos = (n: number) => Math.round(n * 100);

describe("filasDeUnaVenta: lo que cierra por construcción", () => {
  it("la suma de los importes de las filas VENTA es exactamente `importeDeLinea(cantidad, precio)`", () => {
    fc.assert(
      fc.property(ventaArb, (venta) => {
        const ventas = filasDe(venta).filter((f) => f.proceso === "VENTA");
        const suma = ventas.reduce((s, f) => s + centavos(f.precioTotal), 0);
        expect(suma).toBe(centavos(importeDeLinea(venta.cantidadVendida, venta.precioVenta)));
      }),
      { numRuns: 1000 }
    );
  });

  it("la suma de las cantidades de las filas VENTA da la cantidad vendida: la última parte se lleva el resto", () => {
    fc.assert(
      fc.property(ventaArb, (venta) => {
        const ventas = filasDe(venta).filter((f) => f.proceso === "VENTA");
        const suma = ventas.reduce((s, f) => s + -f.cantidad, 0);
        expect(Math.abs(suma - r4(venta.cantidadVendida))).toBeLessThan(1e-9);
        // Una fila por parte propia si hay más de una; si no, una sola.
        expect(ventas).toHaveLength(venta.partesPropias && venta.partesPropias.length > 1 ? venta.partesPropias.length : 1);
      }),
      { numRuns: 1000 }
    );
  });

  it("CONSUMO y VENTA salen del stock (cantidad ≤ 0) y la liquidación no mueve cantidad", () => {
    fc.assert(
      fc.property(ventaArb, (venta) => {
        for (const f of filasDe(venta)) {
          if (f.proceso === "LIQUIDACION_CONSIGNACION") expect(f.cantidad).toBe(0);
          else expect(f.cantidad).toBeLessThanOrEqual(0);
          if (f.proceso === "VENTA") expect(f.cantidad).toBeLessThan(0);
        }
      }),
      { numRuns: 1000 }
    );
  });

  it("hay una LIQUIDACION_CONSIGNACION por cada consumo de un producto de consignación, y ninguna más", () => {
    fc.assert(
      fc.property(ventaArb, (venta) => {
        const fs = filasDe(venta);
        const liquidaciones = fs.filter((f) => f.proceso === "LIQUIDACION_CONSIGNACION");
        const esperadas = venta.consumos.filter((c) => PRODUCTOS[c.productoId]!.esConsignacion);
        expect(liquidaciones.map((l) => l.productoId)).toEqual(esperadas.map((c) => c.productoId));
        // Cada liquidación va JUSTO después de su fila CONSUMO.
        fs.forEach((f, i) => {
          if (f.proceso === "LIQUIDACION_CONSIGNACION") expect(fs[i - 1]!.proceso).toBe("CONSUMO");
        });
      }),
      { numRuns: 1000 }
    );
  });

  it("`cantidadExacta` es null exactamente cuando coincide con lo escrito; si no, es la cantidad exacta con el signo de la fila", () => {
    fc.assert(
      fc.property(ventaArb, (venta) => {
        const consumos = filasDe(venta).filter((f) => f.proceso === "CONSUMO");
        expect(consumos).toHaveLength(venta.consumos.length);
        consumos.forEach((fila, i) => {
          const exacta = r8(venta.consumos[i]!.cantidad);
          const escrita = -fila.cantidad;
          expect(fila.cantidadExacta === null).toBe(exacta === escrita);
          if (fila.cantidadExacta !== null) expect(fila.cantidadExacta).toBe(-exacta);
        });
      }),
      { numRuns: 1000 }
    );
  });
});
