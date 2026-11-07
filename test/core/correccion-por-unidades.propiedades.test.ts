import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { construirReversionDeVenta } from "../../src/core/movimientos/anulaciones";
import { copiarVentaConMenosUnidades, diferenciaDeStock, unidadesVendidas, type LineaParaCorregir } from "../../src/core/movimientos/correccion-por-unidades";

/** Módulo puro: sin base. E1 de docs/diseno-correccion-por-ajuste-2026-11-06.md (nivel 10): A + R = 0, B − A = lo pedido, centavos exactos. */

const centavos = (n: number) => Math.round(n * 100) + 0;
const suma = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0);

const venta = (o: Partial<LineaParaCorregir> & Pick<LineaParaCorregir, "cantidad" | "precioTotal">): LineaParaCorregir => ({
  productoId: "pv",
  seccionId: "salon",
  proceso: "VENTA",
  cantidadExacta: null,
  loteVencimiento: null,
  detalle: "Venta",
  precioPorUnidadStock: 0,
  costoUnitarioVenta: null,
  precioListaUnitario: null,
  sustituyeAProductoId: null,
  ...o,
});

/** Una venta generada: N unidades repartidas en 1 a 3 lotes, a un precio por unidad con centavos, más un insumo que consume `porUnidad` por cada una. */
const ventaGenerada = fc
  .record({
    lotes: fc.array(fc.integer({ min: 1, max: 6 }), { minLength: 1, maxLength: 3 }),
    precioCentavos: fc.integer({ min: 0, max: 2_000_000 }),
    costoCentavos: fc.option(fc.integer({ min: 0, max: 900_000 }), { nil: null }),
    listaCentavos: fc.option(fc.integer({ min: 1, max: 2_500_000 }), { nil: null }),
    insumoPorUnidadMilesimas: fc.integer({ min: 1, max: 2500 }),
    conConsignacion: fc.boolean(),
  })
  .filter((v) => suma(v.lotes) >= 2)
  .chain((v) => fc.record({ v: fc.constant(v), quitar: fc.integer({ min: 1, max: suma(v.lotes) - 1 }) }));

function armarA(v: { lotes: number[]; precioCentavos: number; costoCentavos: number | null; listaCentavos: number | null; insumoPorUnidadMilesimas: number; conConsignacion: boolean }): LineaParaCorregir[] {
  const precio = v.precioCentavos / 100;
  const total = suma(v.lotes);
  const lineas: LineaParaCorregir[] = [];
  // Un insumo repartido en los mismos lotes: consume `porUnidad` por unidad vendida, ya redondeado a 3 decimales.
  v.lotes.forEach((q, i) => {
    lineas.push(
      venta({
        productoId: "insumo",
        proceso: "CONSUMO",
        cantidad: -Math.round(q * v.insumoPorUnidadMilesimas) / 1000,
        loteVencimiento: new Date(Date.UTC(2027, 0, i + 1)),
        detalle: "Consumo",
        precioTotal: 0,
      })
    );
    if (v.conConsignacion) lineas.push(venta({ productoId: "insumo", proceso: "LIQUIDACION_CONSIGNACION", cantidad: 0, precioTotal: (q * 1500) / 100, detalle: "Liquidación" }));
  });
  v.lotes.forEach((q, i) =>
    lineas.push(
      venta({
        cantidad: -q,
        loteVencimiento: new Date(Date.UTC(2027, 0, i + 1)),
        precioTotal: (q * v.precioCentavos) / 100,
        precioPorUnidadStock: precio,
        costoUnitarioVenta: v.costoCentavos === null ? null : v.costoCentavos / 100,
        precioListaUnitario: v.listaCentavos === null ? null : v.listaCentavos / 100,
      })
    )
  );
  expect(unidadesVendidas(lineas)).toBe(total);
  return lineas;
}

/** El producto vendido se vende en unidades enteras (0 decimales); el insumo se lleva en una unidad con 3 decimales. */
const decimalesDe = (productoId: string) => (productoId === "pv" ? 0 : 3);
const copiar = (a: LineaParaCorregir[], quitar: number) => copiarVentaConMenosUnidades(a, { unidadesOriginales: unidadesVendidas(a), unidadesAQuitar: quitar, decimalesDe });

describe("corrección por unidades: propiedades", () => {
  it("A + R = 0 exacto: el contra-asiento deja stock e importe de la venta original en cero", () => {
    fc.assert(
      fc.property(ventaGenerada, ({ v }) => {
        const a = armarA(v);
        const r = construirReversionDeVenta(a);
        const stock = diferenciaDeStock(r, a.map((l) => ({ ...l, cantidad: -l.cantidad })));
        // R es A al revés: sumar A y R da 0 por (producto, sección, lote).
        const netoPorClave = new Map<string, number>();
        for (const l of [...a, ...r]) {
          const k = `${l.productoId}|${l.seccionId}|${l.proceso === "LIQUIDACION_CONSIGNACION" ? "L" : ""}|${l.loteVencimiento?.toISOString() ?? ""}`;
          netoPorClave.set(k, Math.round(((netoPorClave.get(k) ?? 0) + l.cantidad) * 1e4) / 1e4);
        }
        expect([...netoPorClave.values()].every((x) => Math.abs(x) === 0)).toBe(true);
        expect(centavos(suma([...a, ...r].map((l) => l.precioTotal)))).toBe(0);
        expect(stock.size).toBeGreaterThan(0);
      }),
      { numRuns: 200 }
    );
  });

  it("B − A = lo pedido: se devuelven exactamente las unidades quitadas, y nunca sale más stock que antes", () => {
    fc.assert(
      fc.property(ventaGenerada, ({ v, quitar }) => {
        const a = armarA(v);
        const b = copiar(a, quitar);
        expect(unidadesVendidas(b)).toBe(unidadesVendidas(a) - quitar);
        const soloVenta = (ls: LineaParaCorregir[]) => ls.filter((l) => l.proceso === "VENTA");
        const dif = diferenciaDeStock(soloVenta(a), soloVenta(b));
        expect(Math.round(suma([...dif.values()]))).toBe(quitar);
        // Ninguna fila de B consume más que la de A en su mismo lote (la corrección solo devuelve stock).
        for (const [clave, d] of diferenciaDeStock(a, b)) expect(d, clave).toBeGreaterThanOrEqual(0);
        // El consumo de insumo que queda es el proporcional, redondeado a la unidad (3 decimales), con suma exacta.
        const consumoA = -suma(a.filter((l) => l.proceso === "CONSUMO").map((l) => l.cantidad));
        const consumoB = -suma(b.filter((l) => l.proceso === "CONSUMO").map((l) => l.cantidad));
        const esperado = Math.round((consumoA * (unidadesVendidas(a) - quitar)) / unidadesVendidas(a) * 1000) / 1000;
        expect(Math.abs(consumoB - esperado)).toBeLessThan(0.0011);
      }),
      { numRuns: 300 }
    );
  });

  it("los importes suman exacto en centavos: lo que queda es (unidades que quedan × precio) y la liquidación de consignación, la proporción exacta", () => {
    fc.assert(
      fc.property(ventaGenerada, ({ v, quitar }) => {
        const a = armarA(v);
        const b = copiar(a, quitar);
        const n = unidadesVendidas(a);
        const ventasB = b.filter((l) => l.proceso === "VENTA");
        expect(centavos(suma(ventasB.map((l) => l.precioTotal)))).toBe((n - quitar) * v.precioCentavos);
        // Cada fila VENTA de B cobra exactamente sus unidades × el precio por unidad (la copia de la fila no inventa centavos).
        for (const l of ventasB) expect(centavos(l.precioTotal)).toBe(Math.round(-l.cantidad) * v.precioCentavos);
        const liqA = suma(a.filter((l) => l.proceso === "LIQUIDACION_CONSIGNACION").map((l) => centavos(l.precioTotal)));
        const liqB = suma(b.filter((l) => l.proceso === "LIQUIDACION_CONSIGNACION").map((l) => centavos(l.precioTotal)));
        const esperadaLiq = Math.round((liqA * (n - quitar)) / n);
        expect(Math.abs(liqB - esperadaLiq)).toBeLessThanOrEqual(1);
        expect(liqB).toBeLessThanOrEqual(liqA);
      }),
      { numRuns: 300 }
    );
  });

  it("lo congelado se copia tal cual: precio por unidad, precio de lista y costo (un costo vacío sigue vacío, un $0 sigue en $0), sin recalcular", () => {
    fc.assert(
      fc.property(ventaGenerada, ({ v, quitar }) => {
        const a = armarA(v);
        const b = copiar(a, quitar);
        for (const l of b.filter((x) => x.proceso === "VENTA")) {
          expect(l.precioPorUnidadStock).toBe(v.precioCentavos / 100);
          expect(l.costoUnitarioVenta).toBe(v.costoCentavos === null ? null : v.costoCentavos / 100);
          expect(l.precioListaUnitario).toBe(v.listaCentavos === null ? null : v.listaCentavos / 100);
        }
        // Mismos lotes y secciones: B nunca inventa un lote que A no tenía.
        const lotesA = new Set(a.map((l) => `${l.productoId}|${l.seccionId}|${l.loteVencimiento?.toISOString() ?? ""}`));
        for (const l of b) expect(lotesA.has(`${l.productoId}|${l.seccionId}|${l.loteVencimiento?.toISOString() ?? ""}`)).toBe(true);
      }),
      { numRuns: 200 }
    );
  });

  it("una venta en $0 (sin dato) se copia en $0: no se inventa un importe", () => {
    fc.assert(
      fc.property(ventaGenerada, ({ v, quitar }) => {
        const a = armarA({ ...v, precioCentavos: 0, conConsignacion: false });
        const b = copiar(a, quitar);
        expect(b.filter((l) => l.proceso === "VENTA").every((l) => l.precioTotal === 0)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });
});

describe("corrección por unidades: casos con números reales", () => {
  it("$9.000 entre 2 unidades: quitar 1 deja 1 a $4.500", () => {
    const a = [venta({ cantidad: -2, precioTotal: 9000, precioPorUnidadStock: 4500 })];
    const [b] = copiarVentaConMenosUnidades(a, { unidadesOriginales: 2, unidadesAQuitar: 1, decimalesDe: () => 0 });
    expect(b).toMatchObject({ cantidad: -1, precioTotal: 4500, precioPorUnidadStock: 4500 });
  });

  it("2 cervezas a $14.000 en dos lotes (1 + 1): se quita 1 y queda el primer lote; el lote vaciado no se escribe", () => {
    const a = [
      venta({ cantidad: -1, precioTotal: 14000, precioPorUnidadStock: 14000, loteVencimiento: new Date(Date.UTC(2027, 0, 1)) }),
      venta({ cantidad: -1, precioTotal: 14000, precioPorUnidadStock: 14000, loteVencimiento: new Date(Date.UTC(2027, 0, 2)) }),
    ];
    const b = copiarVentaConMenosUnidades(a, { unidadesOriginales: 2, unidadesAQuitar: 1, decimalesDe: () => 0 });
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ cantidad: -1, precioTotal: 14000 });
  });

  it("un reparto que no cae justo (3 unidades a $100,01 en total $300,03, se quita 1) cierra en centavos exactos", () => {
    const a = [venta({ cantidad: -3, precioTotal: 300.03, precioPorUnidadStock: 100.01 })];
    const [b] = copiarVentaConMenosUnidades(a, { unidadesOriginales: 3, unidadesAQuitar: 1, decimalesDe: () => 0 });
    expect(b.precioTotal).toBe(200.02);
  });

  it("rechaza lo que no es una corrección parcial: 0 unidades, todas, o una fracción", () => {
    const a = [venta({ cantidad: -2, precioTotal: 9000, precioPorUnidadStock: 4500 })];
    for (const quitar of [0, 2, 1.5, -1]) {
      expect(() => copiarVentaConMenosUnidades(a, { unidadesOriginales: 2, unidadesAQuitar: quitar, decimalesDe: () => 0 })).toThrow();
    }
  });
});
