import { describe, expect, it } from "vitest";
import { armarParametrosPorInsumo, filaDeMinimoQueRige } from "../../src/core/stock/parametros-por-insumo";

/** «Parámetros por insumo» (DEC-27): el armado puro de la tabla y la fila de mínimo que rige para el atajo «Cambiar mínimo». */
const leche = { codigo: "MP-2", nombre: "Leche" };
const harina = { codigo: "MP-1", nombre: "Harina" };

describe("armarParametrosPorInsumo", () => {
  it("junta por producto el mínimo global, los de cada depósito (por nombre), el depósito habitual y la frecuencia, ordenado por nombre", () => {
    const filas = armarParametrosPorInsumo({
      minimos: [
        { id: "m1", productoId: "L", seccionId: null, minimo: 12, producto: leche, seccion: null },
        { id: "m2", productoId: "L", seccionId: "s2", minimo: 3.5, producto: leche, seccion: { nombre: "Cocina" } },
        { id: "m3", productoId: "L", seccionId: "s1", minimo: 1, producto: leche, seccion: { nombre: "Barra" } },
      ],
      habituales: [{ id: "h1", productoId: "H", producto: harina, seccion: { nombre: "Cocina" } }],
      frecuencias: [{ id: "f1", productoId: "L", frecuenciaDias: 0, producto: leche }],
    });
    expect(filas).toEqual([
      { productoId: "H", productoCodigo: "MP-1", productoNombre: "Harina", minimoGlobal: null, minimosPorDeposito: [], depositoHabitual: { id: "h1", deposito: "Cocina" }, frecuencia: null },
      {
        productoId: "L",
        productoCodigo: "MP-2",
        productoNombre: "Leche",
        minimoGlobal: { id: "m1", minimo: 12 },
        minimosPorDeposito: [
          { id: "m3", deposito: "Barra", minimo: 1 },
          { id: "m2", deposito: "Cocina", minimo: 3.5 },
        ],
        depositoHabitual: null,
        frecuencia: { id: "f1", dias: 0 },
      },
    ]);
  });

  it("sin listas (el rol no ve ninguna) no hay filas; un mínimo 0 es un mínimo cargado, no «sin cargar»", () => {
    expect(armarParametrosPorInsumo({})).toEqual([]);
    const [fila] = armarParametrosPorInsumo({ minimos: [{ id: "m", productoId: "L", seccionId: null, minimo: 0, producto: leche, seccion: null }] });
    expect(fila.minimoGlobal).toEqual({ id: "m", minimo: 0 });
  });
});

describe("filaDeMinimoQueRige", () => {
  const minimos = [
    { id: "global-L", productoId: "L", seccionId: null },
    { id: "cocina-L", productoId: "L", seccionId: "cocina" },
    { id: "global-H", productoId: "H", seccionId: null },
  ];

  it("gana la del depósito; si no hay, la global; si no hay ninguna, null", () => {
    expect(filaDeMinimoQueRige(minimos, "L", "cocina")?.id).toBe("cocina-L");
    expect(filaDeMinimoQueRige(minimos, "L", "barra")?.id).toBe("global-L");
    expect(filaDeMinimoQueRige(minimos, "H", "cocina")?.id).toBe("global-H");
    expect(filaDeMinimoQueRige(minimos, "X", "cocina")).toBeNull();
  });

  it("no toma la fila de un depósito de OTRO producto", () => {
    expect(filaDeMinimoQueRige([{ id: "cocina-H", productoId: "H", seccionId: "cocina" }], "L", "cocina")).toBeNull();
  });
});
