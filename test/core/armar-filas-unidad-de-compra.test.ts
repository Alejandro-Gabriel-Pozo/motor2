import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { armarFilasDeMovimiento, type LineaParaFilas } from "../../src/core/movimientos/armar-filas-de-movimiento";
import type { ProcesoGenerico } from "../../src/core/features/movimientos/movimiento.schema";

/**
 * Compras, etapa 2a: `armarFilasDeMovimiento` copia la unidad de compra y lo comprado (`unidadCompraId`, `cantidadCompra`) a la fila SOLO en una COMPRA, las dos juntas o ninguna, y no toca cantidad, precio ni el resto de las filas
 * (docs/diseno-compras-factura-unica-y-rechazo-2026-11-03.md §14.2). Función pura: sin base ni reloj.
 */
const CTX = (proceso: ProcesoGenerico) => ({ operacionId: "op1", proceso, seccionId: "sec1", seccionDestinoId: proceso === "TRANSFERENCIA" ? "sec2" : null });
const linea = (extra: Partial<LineaParaFilas> = {}): LineaParaFilas => ({
  productoId: "p1", cantidadFirmada: 75, cantidadIngresada: 75, loteVencimiento: null, detalle: "3 × 25 = 75 kg", precioTotal: 1500, precioPorUnidadStock: 20, consumosReceta: [], ...extra,
});

describe("armarFilasDeMovimiento: unidad de compra y lo comprado", () => {
  it("COMPRA con las dos: la fila las lleva, y cantidad, precio y detalle quedan exactamente como siempre", () => {
    const [fila] = armarFilasDeMovimiento(CTX("COMPRA"), [linea({ unidadCompraId: "caja", cantidadCompra: 3 })]);
    expect(fila).toEqual({
      operacionId: "op1", productoId: "p1", seccionId: "sec1", proceso: "COMPRA", cantidad: 75, loteVencimiento: null, detalle: "3 × 25 = 75 kg", precioTotal: 1500, precioPorUnidadStock: 20,
      unidadCompraId: "caja", cantidadCompra: 3,
    });
  });

  it("COMPRA sin ellas (pendiente de completar): la fila NO trae las claves, idéntica a la de antes de la etapa", () => {
    const [fila] = armarFilasDeMovimiento(CTX("COMPRA"), [linea()]);
    expect(Object.keys(fila!)).not.toContain("unidadCompraId");
    expect(Object.keys(fila!)).not.toContain("cantidadCompra");
  });

  it("la unidad sin la cantidad (o al revés) no se escribe a medias: viola el CHECK de la base, así que no sale", () => {
    for (const parcial of [{ unidadCompraId: "caja", cantidadCompra: null }, { unidadCompraId: null, cantidadCompra: 3 }, { unidadCompraId: "caja" }, { cantidadCompra: 3 }]) {
      const [fila] = armarFilasDeMovimiento(CTX("COMPRA"), [linea(parcial)]);
      expect(Object.keys(fila!), JSON.stringify(parcial)).not.toContain("unidadCompraId");
      expect(Object.keys(fila!), JSON.stringify(parcial)).not.toContain("cantidadCompra");
    }
  });

  it("propiedad: cualquier proceso que NO sea COMPRA nunca escribe unidad ni cantidad comprada, aunque la línea las traiga", () => {
    const procesos: ProcesoGenerico[] = ["PRODUCCION", "CONSUMO", "AJUSTE", "MERMA", "DEVOLUCION_CONSIGNACION", "DEVOLUCION_CLIENTE", "DEVOLUCION_PROVEEDOR", "TRANSFERENCIA"];
    fc.assert(
      fc.property(fc.constantFrom(...procesos), fc.double({ min: 0.0001, max: 1000, noNaN: true }), (proceso, cantidadCompra) => {
        const filas = armarFilasDeMovimiento(CTX(proceso), [linea({ unidadCompraId: "caja", cantidadCompra })]);
        for (const f of filas) {
          expect(Object.keys(f)).not.toContain("unidadCompraId");
          expect(Object.keys(f)).not.toContain("cantidadCompra");
        }
      }),
      { numRuns: 300 }
    );
  });

  it("propiedad: en una COMPRA, copiar lo comprado no cambia ni la cantidad ni el precio de ninguna fila", () => {
    fc.assert(
      fc.property(fc.double({ min: 0.0001, max: 1000, noNaN: true }), fc.double({ min: 0, max: 100000, noNaN: true }), (cantidadCompra, precioTotal) => {
        const base = armarFilasDeMovimiento(CTX("COMPRA"), [linea({ precioTotal })]);
        const con = armarFilasDeMovimiento(CTX("COMPRA"), [linea({ precioTotal, unidadCompraId: "caja", cantidadCompra })]);
        expect(con.map(({ unidadCompraId: _u, cantidadCompra: _c, ...resto }) => resto)).toEqual(base);
      }),
      { numRuns: 300 }
    );
  });
});
