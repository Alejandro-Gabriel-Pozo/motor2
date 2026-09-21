import { describe, expect, it } from "vitest";
import { claveDeLote, construirReversion, evaluarAnulacion, type CompraAAnular, type LineaComprada } from "../../src/core/compras/anulacion";

/** Módulo puro: sin base de datos, sin mocks. */
const linea = (sobre: Partial<LineaComprada> = {}): LineaComprada => ({
  productoId: "harina",
  productoCodigo: "MP_HARINA",
  productoNombre: "Harina",
  seccionId: "deposito",
  seccionNombre: "Depósito",
  loteVencimiento: null,
  cantidad: 10,
  precioTotal: 1000,
  precioPorUnidadStock: 100,
  detalle: "Compra",
  ...sobre,
});
const compra = (lineas: LineaComprada[], sobre: Partial<CompraAAnular> = {}): CompraAAnular => ({ proceso: "COMPRA", anuladaEn: null, lineas, ...sobre });
const saldos = (...pares: Array<[LineaComprada, number]>) => new Map(pares.map(([l, s]) => [claveDeLote(l.productoId, l.seccionId, l.loteVencimiento), s]));

describe("evaluarAnulacion — cuándo se puede anular una compra", () => {
  it("con todo lo comprado todavía en stock, se puede anular y devuelve una reversión por línea", () => {
    const l = linea();
    const r = evaluarAnulacion(compra([l]), saldos([l, 10]));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.reversion).toHaveLength(1);
  });

  it("con MÁS stock del comprado (había stock previo o se compró más) también se puede", () => {
    const l = linea();
    expect(evaluarAnulacion(compra([l]), saldos([l, 25])).ok).toBe(true);
  });

  it("si ya se consumió parte de lo comprado, se bloquea y dice qué falta", () => {
    const l = linea();
    const r = evaluarAnulacion(compra([l]), saldos([l, 4]));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toBe("STOCK_CONSUMIDO");
    expect(r.faltantes).toEqual([{ productoNombre: "Harina", seccionNombre: "Depósito", loteVencimiento: null, comprado: 10, disponible: 4 }]);
    expect(r.mensaje).toContain("Harina");
    expect(r.mensaje).toContain("se compraron 10 y hoy quedan 4");
    expect(r.mensaje).toContain("Devolución a proveedor"); // la salida que se ofrece
  });

  it("sin ningún saldo registrado para el lote (consumido del todo), se bloquea", () => {
    const l = linea();
    expect(evaluarAnulacion(compra([l]), new Map()).ok).toBe(false);
  });

  it("es por LOTE: si el lote de esta compra ya se vendió, se bloquea aunque haya stock de otro lote del mismo producto", () => {
    const loteViejo = new Date("2026-10-01T00:00:00.000Z");
    const loteNuevo = new Date("2027-01-01T00:00:00.000Z");
    const comprada = linea({ loteVencimiento: loteNuevo });
    const otroLote = linea({ loteVencimiento: loteViejo });
    const r = evaluarAnulacion(compra([comprada]), saldos([comprada, 0], [otroLote, 500]));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.faltantes[0].loteVencimiento).toEqual(loteNuevo);
    expect(r.mensaje).toContain("lote que vence el 2027-01-01");
  });

  it("dos líneas del mismo producto, sección y lote se suman ANTES de comparar contra el saldo", () => {
    const a = linea({ cantidad: 6 });
    const b = linea({ cantidad: 6 });
    // Cada una por separado (6 <= 10) pasaría; juntas piden 12 y hay 10.
    const r = evaluarAnulacion(compra([a, b]), saldos([a, 10]));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.faltantes).toHaveLength(1);
    expect(r.faltantes[0].comprado).toBe(12);
  });

  it("el mismo producto en dos secciones distintas se evalúa por separado", () => {
    const enDeposito = linea({ seccionId: "deposito", seccionNombre: "Depósito" });
    const enCocina = linea({ seccionId: "cocina", seccionNombre: "Cocina" });
    const r = evaluarAnulacion(compra([enDeposito, enCocina]), saldos([enDeposito, 10], [enCocina, 3]));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.faltantes.map((f) => f.seccionNombre)).toEqual(["Cocina"]);
  });

  it("informa TODAS las líneas que faltan, no solo la primera", () => {
    const harina = linea({ productoId: "harina", productoNombre: "Harina" });
    const queso = linea({ productoId: "queso", productoNombre: "Queso" });
    const r = evaluarAnulacion(compra([harina, queso]), saldos([harina, 1], [queso, 2]));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.faltantes.map((f) => f.productoNombre)).toEqual(["Harina", "Queso"]);
  });

  it("tolera el ruido de coma flotante en el saldo (9,9999999999 cuenta como 10)", () => {
    const l = linea();
    expect(evaluarAnulacion(compra([l]), saldos([l, 9.9999999999])).ok).toBe(true);
    expect(evaluarAnulacion(compra([l]), saldos([l, 9.99])).ok).toBe(false);
  });

  it("una operación que no es Compra no se anula con esta regla", () => {
    const l = linea();
    const r = evaluarAnulacion(compra([l], { proceso: "VENTA" }), saldos([l, 10]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("NO_ES_COMPRA");
  });

  it("una compra ya anulada no se anula dos veces", () => {
    const l = linea();
    const r = evaluarAnulacion(compra([l], { anuladaEn: new Date() }), saldos([l, 10]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("YA_ANULADA");
  });

  it("una compra sin líneas no tiene nada que anular", () => {
    const r = evaluarAnulacion(compra([]), new Map());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("SIN_LINEAS");
  });
});

describe("construirReversion — el contra-asiento", () => {
  it("invierte cantidad y precio total, y conserva sección, lote y precio por unidad", () => {
    const lote = new Date("2026-12-31T00:00:00.000Z");
    const l = linea({ cantidad: 25, precioTotal: 2500.5, precioPorUnidadStock: 100.02, loteVencimiento: lote });
    const [rev] = construirReversion([l]);
    expect(rev).toMatchObject({ productoId: "harina", seccionId: "deposito", loteVencimiento: lote, cantidad: -25, precioTotal: -2500.5, precioPorUnidadStock: 100.02 });
    expect(rev.detalle).toContain("Anulación de compra");
    expect(rev.detalle).toContain("Compra");
  });

  it("original + reversión netean EXACTAMENTE a cero en cantidad y en plata", () => {
    const lineas = [linea({ cantidad: 0.1, precioTotal: 0.3 }), linea({ productoId: "queso", cantidad: 7.25, precioTotal: 1234.56 })];
    const rev = construirReversion(lineas);
    lineas.forEach((l, i) => {
      expect(l.cantidad + rev[i].cantidad).toBe(0);
      expect(l.precioTotal + rev[i].precioTotal).toBe(0);
    });
  });

  it("no muta las líneas de entrada", () => {
    const l = linea();
    const copia = structuredClone(l);
    construirReversion([l]);
    expect(l).toEqual(copia);
  });
});

describe("claveDeLote", () => {
  it("distingue lote, sin lote, sección y producto", () => {
    const f = new Date("2026-01-01T00:00:00.000Z");
    const claves = [claveDeLote("p", "s", null), claveDeLote("p", "s", f), claveDeLote("p", "otra", null), claveDeLote("otro", "s", null)];
    expect(new Set(claves).size).toBe(4);
    expect(claveDeLote("p", "s", f)).toBe(claveDeLote("p", "s", new Date(f.getTime())));
  });
});
