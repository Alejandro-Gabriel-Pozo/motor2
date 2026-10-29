import { describe, expect, it } from "vitest";
import { armarVentasPorOpcion, type VentaPorOpcionCruda } from "../../src/core/reportes/ventas-por-opcion";

/**
 * «Ventas por opción» (2026-10-29), la parte pura: de lo que la consulta agrega en SQL a la fila del reporte. Dinero en centavos enteros; el margen solo si TODAS las ventas de la fila guardaron su
 * costo (si no, «costo incompleto» con cuántas faltan: no se reconstruye ni se inventa); el orden por producto, grupo y unidades de mayor a menor.
 */
const cruda = (extra: Partial<VentaPorOpcionCruda> = {}): VentaPorOpcionCruda => ({
  productoId: "p1",
  producto: "Gaseosa 500 cc",
  grupoId: "g1",
  grupo: "Marca",
  opcionId: "o1",
  opcion: "Coca",
  unidades: 2,
  importeCentavos: 500_000,
  costoCentavos: 120_000,
  ventas: 1,
  ventasSinCosto: 0,
  ...extra,
});

describe("armarVentasPorOpcion", () => {
  it("con el costo guardado en todas las ventas: costo, margen en centavos y porcentaje con un decimal", () => {
    const [f] = armarVentasPorOpcion([cruda()]);
    expect(f).toMatchObject({ unidades: 2, importeCentavos: 500_000, costoCentavos: 120_000, margenCentavos: 380_000, margenPorcentaje: 76, costoIncompleto: null });
    // Un porcentaje que no es redondo: 1/3 de margen sobre el importe.
    expect(armarVentasPorOpcion([cruda({ importeCentavos: 30_000, costoCentavos: 20_000 })])[0]!.margenPorcentaje).toBe(33.3);
  });

  it("si a alguna venta no se le guardó el costo: sin costo ni margen, y se dice cuántas de cuántas (no se reconstruye)", () => {
    const [f] = armarVentasPorOpcion([cruda({ ventas: 3, ventasSinCosto: 2, costoCentavos: 40_000 })]);
    expect(f).toMatchObject({ costoCentavos: null, margenCentavos: null, margenPorcentaje: null, costoIncompleto: { sinCosto: 2, de: 3 }, importeCentavos: 500_000, unidades: 2 });
  });

  it("importe 0: hay margen en centavos pero no porcentaje (nunca una división por cero)", () => {
    const [f] = armarVentasPorOpcion([cruda({ importeCentavos: 0, costoCentavos: 0 })]);
    expect(f).toMatchObject({ margenCentavos: 0, margenPorcentaje: null });
  });

  it("el margen puede ser negativo (se vendió por debajo del costo)", () => {
    expect(armarVentasPorOpcion([cruda({ importeCentavos: 10_000, costoCentavos: 15_000 })])[0]).toMatchObject({ margenCentavos: -5_000, margenPorcentaje: -50 });
  });

  it("orden: producto, grupo y, dentro del grupo, la opción que más se vendió primero (empate por nombre)", () => {
    const filas = armarVentasPorOpcion([
      cruda({ productoId: "p2", producto: "Wok", grupo: "Proteína", opcionId: "o9", opcion: "Pollo", unidades: 5 }),
      cruda({ opcionId: "o2", opcion: "Fanta", unidades: 1 }),
      cruda({ opcionId: "o1", opcion: "Coca", unidades: 7 }),
      cruda({ opcionId: "o3", opcion: "Sprite", unidades: 1 }),
      cruda({ grupoId: "g0", grupo: "Hielo", opcionId: "o4", opcion: "Con hielo", unidades: 2 }),
    ]);
    expect(filas.map((f) => [f.producto, f.grupo, f.opcion])).toEqual([
      ["Gaseosa 500 cc", "Hielo", "Con hielo"],
      ["Gaseosa 500 cc", "Marca", "Coca"],
      ["Gaseosa 500 cc", "Marca", "Fanta"],
      ["Gaseosa 500 cc", "Marca", "Sprite"],
      ["Wok", "Proteína", "Pollo"],
    ]);
  });

  it("sin ventas con opciones, una lista vacía", () => {
    expect(armarVentasPorOpcion([])).toEqual([]);
  });
});
