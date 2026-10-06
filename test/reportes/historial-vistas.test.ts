import { describe, expect, it } from "vitest";
import { Proceso } from "@prisma/client";
import {
  GRUPO_POR_PROCESO,
  agruparVentasPorDia,
  filtrarEventosKardex,
  quitarDineroDeEventos,
  resolverRangoHistorial,
  resumirCompras,
  variacionPorcentual,
} from "../../src/core/reportes/historial-vistas";

describe("GRUPO_POR_PROCESO", () => {
  it("clasifica exhaustivamente los 16 Proceso del enum, sin ninguno afuera", () => {
    const valoresEnum = Object.values(Proceso);
    expect(Object.keys(GRUPO_POR_PROCESO).sort()).toEqual([...valoresEnum].sort());
  });

  it("COMPRA y DEVOLUCION_PROVEEDOR son 'compras'", () => {
    expect(GRUPO_POR_PROCESO.COMPRA).toBe("compras");
    expect(GRUPO_POR_PROCESO.DEVOLUCION_PROVEEDOR).toBe("compras");
  });

  it("AJUSTE, CONTROL y RECLASIFICACION son 'ajustes-conteos'", () => {
    expect(GRUPO_POR_PROCESO.AJUSTE).toBe("ajustes-conteos");
    expect(GRUPO_POR_PROCESO.CONTROL).toBe("ajustes-conteos");
    expect(GRUPO_POR_PROCESO.RECLASIFICACION).toBe("ajustes-conteos");
  });

  it("CONSUMO y VENTA son 'consumos-ventas'", () => {
    expect(GRUPO_POR_PROCESO.CONSUMO).toBe("consumos-ventas");
    expect(GRUPO_POR_PROCESO.VENTA).toBe("consumos-ventas");
  });
});

describe("filtrarEventosKardex", () => {
  const eventos = [
    { tipo: "movimiento" as const, proceso: "COMPRA", saldoCorriente: 10 },
    { tipo: "movimiento" as const, proceso: "CONSUMO", saldoCorriente: 8 },
    { tipo: "movimiento" as const, proceso: "VENTA", saldoCorriente: 5 },
    { tipo: "conteo" as const, saldoCorriente: 5 },
    { tipo: "movimiento" as const, proceso: "AJUSTE", saldoCorriente: 6 },
  ];

  it("'todo' devuelve todos los eventos sin tocar nada", () => {
    expect(filtrarEventosKardex(eventos, "todo")).toEqual(eventos);
  });

  it("'compras' deja solo COMPRA", () => {
    const r = filtrarEventosKardex(eventos, "compras");
    expect(r).toHaveLength(1);
    expect(r[0]!.proceso).toBe("COMPRA");
  });

  it("'consumos-ventas' deja CONSUMO y VENTA", () => {
    const r = filtrarEventosKardex(eventos, "consumos-ventas");
    expect(r.map((e) => e.proceso)).toEqual(["CONSUMO", "VENTA"]);
  });

  it("'ajustes-conteos' incluye el AJUSTE y también los eventos tipo 'conteo' (que no tienen Proceso)", () => {
    const r = filtrarEventosKardex(eventos, "ajustes-conteos");
    expect(r).toHaveLength(2);
    expect(r.some((e) => e.tipo === "conteo")).toBe(true);
    expect(r.some((e) => e.proceso === "AJUSTE")).toBe(true);
  });

  it("preserva TODOS los campos del evento (en particular saldoCorriente, ya calculado antes del filtro)", () => {
    const r = filtrarEventosKardex(eventos, "compras");
    expect(r[0]!.saldoCorriente).toBe(10); // el mismo valor de arriba — nunca se recalcula al filtrar
  });
});

describe("variacionPorcentual", () => {
  it("precio que sube: porcentaje positivo, redondeado a 1 decimal", () => {
    expect(variacionPorcentual(1100, 1000)).toBe(10);
    expect(variacionPorcentual(1023, 1000)).toBe(2.3);
  });

  it("precio que baja: porcentaje negativo", () => {
    expect(variacionPorcentual(900, 1000)).toBe(-10);
  });

  it("sin compra anterior (primera del rango): null", () => {
    expect(variacionPorcentual(1000, null)).toBeNull();
  });

  it("compra anterior sin precio cargado (0): null, NUNCA Infinity", () => {
    expect(variacionPorcentual(1000, 0)).toBeNull();
  });

  it("compra actual sin precio cargado (0): null, NUNCA -100%", () => {
    expect(variacionPorcentual(0, 1000)).toBeNull();
  });

  it("sin precio actual: null", () => {
    expect(variacionPorcentual(null, 1000)).toBeNull();
  });
});

describe("resumirCompras", () => {
  const base = { tipo: "movimiento" as const, proceso: "COMPRA", anulada: false };

  it("calcula mediana, compras/semana, min/max y variación contra la compra anterior, en orden cronológico", () => {
    const eventos = [
      { ...base, fecha: new Date("2026-01-15"), cantidadConSigno: 25, precioPorUnidadStock: 1000, proveedorNombre: "Molino Sur", nroFactura: "A-1", idOperacion: "op1" },
      { ...base, fecha: new Date("2026-01-01"), cantidadConSigno: 25, precioPorUnidadStock: 900, proveedorNombre: "Molino Sur", nroFactura: "A-0", idOperacion: "op0" },
      { ...base, fecha: new Date("2026-01-29"), cantidadConSigno: 30, precioPorUnidadStock: 1100, proveedorNombre: "Molino Norte", nroFactura: "B-1", idOperacion: "op2" },
    ];

    const r = resumirCompras(eventos);

    expect(r.cantidadCompras).toBe(3);
    expect(r.filas.map((f) => f.idOperacion)).toEqual(["op0", "op1", "op2"]); // ordenado por fecha, no por como llegó
    expect(r.filas[0]!.variacionPct).toBeNull(); // primera del rango
    expect(r.filas[1]!.variacionPct).toBeCloseTo(11.1, 1); // 1000 vs 900
    expect(r.medianaCantidad).toBe(25);
    expect(r.precioMin).toBe(900);
    expect(r.precioMax).toBe(1100);
    expect(r.proveedores).toEqual(["Molino Sur", "Molino Norte"]);
    // 28 días de intervalo (1 al 29 de enero), 3 compras: 3 / 28 * 7 = 0.75/semana, redondeado a 1 decimal (0.8)
    expect(r.comprasPorSemana).toBe(0.8);
  });

  it("excluye las anuladas", () => {
    const eventos = [
      { ...base, fecha: new Date("2026-01-01"), cantidadConSigno: 25, precioPorUnidadStock: 1000, proveedorNombre: "X", nroFactura: null, idOperacion: "op1" },
      { ...base, anulada: true, fecha: new Date("2026-01-02"), cantidadConSigno: 999, precioPorUnidadStock: 1, proveedorNombre: "X", nroFactura: null, idOperacion: "op2" },
    ];
    const r = resumirCompras(eventos);
    expect(r.cantidadCompras).toBe(1);
    expect(r.filas[0]!.idOperacion).toBe("op1");
  });

  it("excluye lo que no es COMPRA (ej. CONSUMO, VENTA) aunque venga en la misma lista", () => {
    const eventos = [
      { ...base, fecha: new Date("2026-01-01"), cantidadConSigno: 25, precioPorUnidadStock: 1000, proveedorNombre: "X", nroFactura: null, idOperacion: "op1" },
      { tipo: "movimiento" as const, proceso: "CONSUMO", anulada: false, fecha: new Date("2026-01-02"), cantidadConSigno: -5, proveedorNombre: null, nroFactura: null, idOperacion: "op2" },
    ];
    expect(resumirCompras(eventos).cantidadCompras).toBe(1);
  });

  it("con menos de 2 compras, comprasPorSemana es null (no hay intervalo para calcular una tasa)", () => {
    const eventos = [{ ...base, fecha: new Date("2026-01-01"), cantidadConSigno: 25, precioPorUnidadStock: 1000, proveedorNombre: "X", nroFactura: null, idOperacion: "op1" }];
    expect(resumirCompras(eventos).comprasPorSemana).toBeNull();
  });

  it("sin ninguna compra: todo en su valor 'vacío', sin tirar error", () => {
    const r = resumirCompras([]);
    expect(r).toEqual({ filas: [], cantidadCompras: 0, medianaCantidad: null, comprasPorSemana: null, precioMin: null, precioMax: null, proveedores: [] });
  });

  it("proveedores sin duplicados, en orden de primera aparición", () => {
    const eventos = [
      { ...base, fecha: new Date("2026-01-01"), cantidadConSigno: 25, precioPorUnidadStock: 1000, proveedorNombre: "A", nroFactura: null, idOperacion: "op1" },
      { ...base, fecha: new Date("2026-01-02"), cantidadConSigno: 25, precioPorUnidadStock: 1000, proveedorNombre: "B", nroFactura: null, idOperacion: "op2" },
      { ...base, fecha: new Date("2026-01-03"), cantidadConSigno: 25, precioPorUnidadStock: 1000, proveedorNombre: "A", nroFactura: null, idOperacion: "op3" },
    ];
    expect(resumirCompras(eventos).proveedores).toEqual(["A", "B"]);
  });
});

describe("resolverRangoHistorial", () => {
  const ahora = new Date("2026-06-15T12:00:00Z");

  it("sin nada en searchParams: últimos 10 días (9 atrás + hoy), sin hasta (abierto a hoy)", () => {
    const r = resolverRangoHistorial({}, ahora);
    expect(r.rango).toBe("10d");
    expect(r.desde?.toISOString().slice(0, 10)).toBe("2026-06-06"); // 9 días antes del 15/06
    expect(r.hasta).toBeUndefined();
  });

  it("rango=90d (el primer «Ver más»): 89 atrás + hoy, sin hasta", () => {
    const r = resolverRangoHistorial({ rango: "90d" }, ahora);
    expect(r.rango).toBe("90d");
    expect(r.desde?.toISOString().slice(0, 10)).toBe("2026-03-18"); // 89 días antes del 15/06
    expect(r.hasta).toBeUndefined();
  });

  it("un rango desconocido cae al default de 10 días", () => {
    expect(resolverRangoHistorial({ rango: "cualquiera" }, ahora).rango).toBe("10d");
  });

  it("rango=todo: sin desde ni hasta (comportamiento de siempre, el historial completo)", () => {
    expect(resolverRangoHistorial({ rango: "todo" }, ahora)).toEqual({ rango: "todo", desde: undefined, hasta: undefined });
  });

  it("con desde explícito: 'personalizado', aunque no venga `rango`", () => {
    const r = resolverRangoHistorial({ desde: "2026-01-01" }, ahora);
    expect(r.rango).toBe("personalizado");
    expect(r.desde).toEqual(new Date("2026-01-01"));
    expect(r.hasta).toBeUndefined();
  });

  it("rango=personalizado sin desde/hasta (primer submit tras elegir la opción, antes de tocar los inputs): sigue siendo 'personalizado', no cae al default", () => {
    expect(resolverRangoHistorial({ rango: "personalizado" }, ahora)).toEqual({ rango: "personalizado", desde: undefined, hasta: undefined });
  });

  it("desde Y hasta explícitos: los dos viajan", () => {
    const r = resolverRangoHistorial({ desde: "2026-01-01", hasta: "2026-01-31" }, ahora);
    expect(r.desde).toEqual(new Date("2026-01-01"));
    expect(r.hasta).toEqual(new Date("2026-01-31"));
  });
});

describe("agruparVentasPorDia", () => {
  const base = { tipo: "movimiento" as const, proceso: "VENTA", anulada: false };

  it("agrupa dos ventas del mismo día, suma cantidad e importe, y calcula el precio promedio", () => {
    const eventos = [
      { ...base, fecha: new Date("2026-01-10T12:00:00Z"), cantidadConSigno: -2, precioTotal: 3000 },
      { ...base, fecha: new Date("2026-01-10T20:00:00Z"), cantidadConSigno: -1, precioTotal: 1500 },
    ];
    const r = agruparVentasPorDia(eventos);
    expect(r).toEqual([{ dia: "2026-01-10", cantidad: 3, importe: 4500, precioPromedio: 1500 }]);
  });

  it("días distintos quedan en filas separadas, ordenadas cronológicamente", () => {
    const eventos = [
      { ...base, fecha: new Date("2026-01-12T12:00:00Z"), cantidadConSigno: -1, precioTotal: 1500 },
      { ...base, fecha: new Date("2026-01-10T12:00:00Z"), cantidadConSigno: -1, precioTotal: 1500 },
    ];
    const r = agruparVentasPorDia(eventos);
    expect(r.map((f) => f.dia)).toEqual(["2026-01-10", "2026-01-12"]);
  });

  it("una venta anulada no suma", () => {
    const eventos = [
      { ...base, fecha: new Date("2026-01-10T12:00:00Z"), cantidadConSigno: -2, precioTotal: 3000 },
      { ...base, anulada: true, fecha: new Date("2026-01-10T13:00:00Z"), cantidadConSigno: -50, precioTotal: 99999 },
    ];
    expect(agruparVentasPorDia(eventos)).toEqual([{ dia: "2026-01-10", cantidad: 2, importe: 3000, precioPromedio: 1500 }]);
  });

  it("ignora movimientos que no son VENTA (ej. el CONSUMO de la receta, misma Operacion)", () => {
    const eventos = [
      { ...base, fecha: new Date("2026-01-10T12:00:00Z"), cantidadConSigno: -1, precioTotal: 1500 },
      { tipo: "movimiento" as const, proceso: "CONSUMO", anulada: false, fecha: new Date("2026-01-10T12:00:00Z"), cantidadConSigno: -1 },
    ];
    expect(agruparVentasPorDia(eventos)).toEqual([{ dia: "2026-01-10", cantidad: 1, importe: 1500, precioPromedio: 1500 }]);
  });

  it("sin ventas: lista vacía", () => {
    expect(agruparVentasPorDia([])).toEqual([]);
  });
});

describe("quitarDineroDeEventos", () => {
  const conDinero = [
    { tipo: "movimiento" as const, proceso: "COMPRA", fecha: new Date("2026-09-01T00:00:00Z"), cantidadConSigno: 5, saldoCorriente: 5, precioTotal: 500, precioPorUnidadStock: 100, proveedorNombre: "P", nroFactura: "A-0001" },
    { tipo: "conteo" as const, fecha: new Date("2026-09-02T00:00:00Z"), conteoReal: 4 },
  ];

  it("saca precioTotal, precioPorUnidadStock, proveedor y N.º de factura de cada evento y conserva el resto", () => {
    const sin = quitarDineroDeEventos(conDinero);
    expect(sin[0]).toEqual({ tipo: "movimiento", proceso: "COMPRA", fecha: new Date("2026-09-01T00:00:00Z"), cantidadConSigno: 5, saldoCorriente: 5 });
    expect("precioTotal" in sin[0]!).toBe(false);
    expect("precioPorUnidadStock" in sin[0]!).toBe(false);
    expect("proveedorNombre" in sin[0]!).toBe(false);
    expect("nroFactura" in sin[0]!).toBe(false);
    expect(sin[1]).toEqual(conDinero[1]);
  });

  it("no muta los eventos originales", () => {
    quitarDineroDeEventos(conDinero);
    expect(conDinero[0]!.precioTotal).toBe(500);
  });

  it("los resúmenes armados sobre eventos sin dinero no inventan precios", () => {
    const sin = quitarDineroDeEventos(conDinero);
    const compras = resumirCompras(sin);
    expect(compras.precioMin).toBeNull();
    expect(compras.filas[0]!.precioPorUnidadStock).toBeNull();
    expect(compras.filas[0]!.variacionPct).toBeNull();
    expect(JSON.stringify(compras)).not.toContain("500");
  });
});
