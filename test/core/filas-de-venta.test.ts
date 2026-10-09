import { describe, expect, it } from "vitest";
import { crearArrastreDeRedondeo } from "../../src/core/movimientos/arrastre-redondeo";
import { filasDeUnaVenta, type ProductoParaFilas } from "../../src/core/movimientos/filas-de-venta";
import type { VentaCalculada } from "../../src/core/movimientos/plan-de-la-venta";

/**
 * Las filas del Kardex de una venta (Hito 5, 5.1 bloque B2b: `core/movimientos/filas-de-venta.ts`, mudadas tal cual desde `registrarVentaEnTx`): sin base. Fija las CLAVES de cada fila y su
 * ORDEN (los goldens de la venta registran los argumentos de la escritura), los textos del detalle, el arrastre de redondeo entre consumos del mismo producto, la liquidación de consignación
 * y el reparto de una venta en varios lotes. Las propiedades (sumas, signos, `cantidadExacta`) están en `filas-de-venta.propiedades.test.ts`; la venta de punta a punta, en las matrices.
 */

const venta = (extra: Partial<VentaCalculada> = {}): VentaCalculada => ({
  productoId: "pv-pan", nombre: "Pan", seProduce: false, cantidadVendida: 1, precioVenta: 100, precioListaVenta: null, costoUnitarioAlVender: null, promoCuentaId: null, pedidos: [],
  seccionId: "s-cocina", loteVencimiento: null, consumos: [], ...extra,
});

const consumo = (productoId: string, cantidad: number, extra: { sustituyeAProductoId?: string; seccionId?: string; loteVencimiento?: Date | null } = {}) => ({
  productoId, seccionId: extra.seccionId ?? "s-cocina", loteVencimiento: extra.loteVencimiento ?? null, cantidad, ...(extra.sustituyeAProductoId ? { sustituyeAProductoId: extra.sustituyeAProductoId } : {}),
});

const harina: ProductoParaFilas = { nombre: "Harina", esConsignacion: false, precioConsignacion: null, unidadStock: { decimales: 2 } };
const bollo: ProductoParaFilas = { nombre: "Bollo", esConsignacion: false, precioConsignacion: null, unidadStock: { decimales: 0 } };
const fiambre: ProductoParaFilas = { nombre: "Fiambre", esConsignacion: true, precioConsignacion: { valueOf: () => "12.5" }, unidadStock: { decimales: 2 } };

function filas(v: VentaCalculada, productos: Record<string, ProductoParaFilas | null> = {}, detalle?: string) {
  return filasDeUnaVenta(v, "op-1", { detalle, productoDe: (id) => productos[id], arrastre: crearArrastreDeRedondeo() });
}

describe("filasDeUnaVenta: una venta simple", () => {
  it("un consumo y el PV: la fila CONSUMO y la fila VENTA, con TODAS sus claves y en su orden", () => {
    const [consumida, vendida, ...resto] = filas(venta({ consumos: [consumo("mp-harina", 0.25)], costoUnitarioAlVender: 30.456, precioListaVenta: 120 }), { "mp-harina": harina });
    expect(resto).toEqual([]);
    expect(consumida).toStrictEqual({
      operacionId: "op-1", productoId: "mp-harina", seccionId: "s-cocina", proceso: "CONSUMO", cantidad: -0.25, cantidadExacta: null, loteVencimiento: null,
      detalle: 'Consumo por venta de "Pan".', precioTotal: 0, precioPorUnidadStock: 0,
    });
    expect(Object.keys(consumida!)).toEqual(["operacionId", "productoId", "seccionId", "proceso", "cantidad", "cantidadExacta", "loteVencimiento", "detalle", "precioTotal", "precioPorUnidadStock"]);
    expect(vendida).toStrictEqual({
      operacionId: "op-1", productoId: "pv-pan", seccionId: "s-cocina", proceso: "VENTA", cantidad: -1, loteVencimiento: null,
      detalle: "Venta", precioTotal: 100, precioPorUnidadStock: 100, costoUnitarioVenta: 30.46, precioListaUnitario: 120,
    });
    expect(Object.keys(vendida!)).toEqual(["operacionId", "productoId", "seccionId", "proceso", "cantidad", "loteVencimiento", "detalle", "precioTotal", "precioPorUnidadStock", "costoUnitarioVenta", "precioListaUnitario"]);
  });

  it("sin costo ni precio de lista, esas dos columnas van en null (la clave existe)", () => {
    const [vendida] = filas(venta());
    expect(vendida).toMatchObject({ proceso: "VENTA", costoUnitarioVenta: null, precioListaUnitario: null });
    expect("costoUnitarioVenta" in vendida!).toBe(true);
    expect("precioListaUnitario" in vendida!).toBe(true);
  });

  it("el detalle de la fila VENTA es el de la venta sin espacios sobrantes, o «Venta» si no hay", () => {
    expect(filas(venta(), {}, "  mesa 4  ")[0]!.detalle).toBe("mesa 4");
    for (const sinTexto of [undefined, "", "   "]) expect(filas(venta(), {}, sinTexto)[0]!.detalle).toBe("Venta");
  });

  it("el precio se redondea a centavos y el importe es cantidad × precio exacto", () => {
    const [vendida] = filas(venta({ cantidadVendida: 0.3, precioVenta: 1234.55 }));
    expect(vendida).toMatchObject({ cantidad: -0.3, precioTotal: 370.37, precioPorUnidadStock: 1234.55 });
  });
});

describe("filasDeUnaVenta: el arrastre de redondeo entre consumos", () => {
  it("dos consumos de 0,5 del mismo bollo (unidad sin decimales) escriben 1 y 0, no 1 y 1 — y `cantidadExacta` solo donde difiere", () => {
    const [primera, segunda] = filas(venta({ consumos: [consumo("mp-bollo", 0.5), consumo("mp-bollo", 0.5)] }), { "mp-bollo": bollo });
    expect(primera).toMatchObject({ proceso: "CONSUMO", cantidad: -1, cantidadExacta: -0.5 });
    expect(segunda).toMatchObject({ proceso: "CONSUMO", cantidadExacta: -0.5 });
    expect(segunda!.cantidad === 0).toBe(true);
  });

  it("el arrastre recibido se MUTA: la deuda de una venta pasa a la siguiente con el mismo arrastre", () => {
    const arrastre = crearArrastreDeRedondeo();
    const productoDe = () => bollo;
    const [a] = filasDeUnaVenta(venta({ consumos: [consumo("mp-bollo", 0.5)] }), "op-1", { detalle: undefined, productoDe, arrastre });
    const [b] = filasDeUnaVenta(venta({ consumos: [consumo("mp-bollo", 0.5)] }), "op-2", { detalle: undefined, productoDe, arrastre });
    expect(a!.cantidad).toBe(-1);
    expect(b!.cantidad === 0).toBe(true);
  });

  it("un producto que no se encontró se redondea a 2 decimales", () => {
    const [consumida] = filas(venta({ consumos: [consumo("mp-fantasma", 0.126)] }), { "mp-fantasma": null });
    expect(consumida).toMatchObject({ cantidad: -0.13, cantidadExacta: -0.126 });
  });
});

describe("filasDeUnaVenta: sustitutos y consignación", () => {
  it("una parte de un SUSTITUTO lleva `sustituyeAProductoId` y el detalle con el nombre del reemplazado; el resto de las filas NO tiene la clave", () => {
    const [normal, sustituta] = filas(venta({ consumos: [consumo("mp-harina", 0.2), consumo("mp-ojo", 0.3, { sustituyeAProductoId: "mp-bife" })] }), {
      "mp-harina": harina, "mp-ojo": harina, "mp-bife": { ...harina, nombre: "Bife de chorizo" },
    });
    expect("sustituyeAProductoId" in normal!).toBe(false);
    expect(normal!.detalle).toBe('Consumo por venta de "Pan".');
    expect(sustituta).toMatchObject({ productoId: "mp-ojo", sustituyeAProductoId: "mp-bife", detalle: 'Consumo por venta de "Pan" — SUSTITUTO de "Bife de chorizo" (no había stock).' });
  });

  it("si la ficha del reemplazado no está, el detalle nombra su id", () => {
    const [sustituta] = filas(venta({ consumos: [consumo("mp-ojo", 0.3, { sustituyeAProductoId: "mp-bife" })] }), { "mp-ojo": harina });
    expect(sustituta!.detalle).toBe('Consumo por venta de "Pan" — SUSTITUTO de "mp-bife" (no había stock).');
  });

  it("un consumo de consignación suma su LIQUIDACION_CONSIGNACION justo después, con el precio leído con Number() y la cantidad ya redondeada", () => {
    const [consumida, liquidacion, vendida] = filas(venta({ consumos: [consumo("mp-fiambre", 0.5)] }), { "mp-fiambre": fiambre });
    expect(consumida).toMatchObject({ proceso: "CONSUMO", productoId: "mp-fiambre" });
    expect(liquidacion).toStrictEqual({
      operacionId: "op-1", productoId: "mp-fiambre", seccionId: "s-cocina", proceso: "LIQUIDACION_CONSIGNACION", cantidad: 0, loteVencimiento: null,
      detalle: 'Liquidación consignación por venta de "Pan".', precioTotal: 6.25, precioPorUnidadStock: 12.5,
    });
    expect(Object.keys(liquidacion!)).toEqual(["operacionId", "productoId", "seccionId", "proceso", "cantidad", "loteVencimiento", "detalle", "precioTotal", "precioPorUnidadStock"]);
    expect(vendida).toMatchObject({ proceso: "VENTA" });
  });

  it("una consignación sin precio liquida a 0, y un producto que no es de consignación no genera liquidación", () => {
    const sinPrecio = filas(venta({ consumos: [consumo("mp-fiambre", 2)] }), { "mp-fiambre": { ...fiambre, precioConsignacion: null } });
    expect(sinPrecio[1]).toMatchObject({ proceso: "LIQUIDACION_CONSIGNACION", precioTotal: 0, precioPorUnidadStock: 0 });
    expect(filas(venta({ consumos: [consumo("mp-harina", 2)] }), { "mp-harina": harina }).map((f) => f.proceso)).toEqual(["CONSUMO", "VENTA"]);
  });
});

describe("filasDeUnaVenta: el PV que se produce y sale de más de un lote", () => {
  const diciembre = new Date("2026-12-01");
  const enero = new Date("2027-01-01");

  it("deja una fila VENTA por lote, con el importe repartido y la ÚLTIMA parte con lo que resta de la cantidad vendida", () => {
    const partesPropias = [
      { productoId: "pv-torta", seccionId: "s-cocina", loteVencimiento: diciembre, cantidad: 0.1 },
      { productoId: "pv-torta", seccionId: "s-deposito", loteVencimiento: enero, cantidad: 0.25 },
    ];
    const ventas = filas(venta({ productoId: "pv-torta", nombre: "Torta", seProduce: true, cantidadVendida: 0.3, precioVenta: 10, partesPropias, seccionId: "s-cocina", loteVencimiento: diciembre }));
    // La segunda parte declara 0,25 pero la venta es de 0,3: la última se lleva el resto (0,3 − 0,1 = 0,2). El importe 3,00 se reparte por los pesos 0,1 y 0,25.
    expect(ventas.map((f) => [f.proceso, f.seccionId, f.loteVencimiento, f.cantidad, f.precioTotal])).toEqual([
      ["VENTA", "s-cocina", diciembre, -0.1, 0.86],
      ["VENTA", "s-deposito", enero, -0.2, 2.14],
    ]);
  });

  it("con una sola parte propia es una fila, como cualquier otro PV", () => {
    const partesPropias = [{ productoId: "pv-torta", seccionId: "s-cocina", loteVencimiento: diciembre, cantidad: 1 }];
    const ventas = filas(venta({ productoId: "pv-torta", nombre: "Torta", seProduce: true, partesPropias, loteVencimiento: diciembre }));
    expect(ventas).toHaveLength(1);
    expect(ventas[0]).toMatchObject({ seccionId: "s-cocina", loteVencimiento: diciembre, cantidad: -1, precioTotal: 100 });
  });
});
