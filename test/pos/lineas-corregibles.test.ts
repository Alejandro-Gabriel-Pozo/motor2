import { describe, expect, it } from "vitest";
import { lineasCorregibles, type ItemConVenta } from "../../src/core/pos/ticket";

/** Las líneas que se pueden corregir en una cuenta cerrada (E0 de la corrección por ajuste): una por venta vigente, la promo como UNA, el adicional con su producto. */
const item = (extra: Partial<ItemConVenta> & Pick<ItemConVenta, "productoId" | "productoNombre" | "operacionId">): ItemConVenta => ({
  cantidad: 1,
  precioUnitario: 1000,
  anuladaEn: null,
  ...extra,
});

describe("lineasCorregibles", () => {
  it("una línea por venta vigente, con la cantidad neta y el subtotal cobrado; las anuladas no aparecen", () => {
    const r = lineasCorregibles(
      [
        item({ productoId: "ce", productoNombre: "Cerveza Patagonia", operacionId: "op1", cantidad: 2, precioUnitario: 14000 }),
        item({ productoId: "br", productoNombre: "Brownie", operacionId: "op2", precioUnitario: 10000 }),
        item({ productoId: "ca", productoNombre: "Café", operacionId: "op3", cantidad: 2, precioUnitario: 4000, anuladaEn: new Date("2026-11-06T12:00:00Z") }),
      ],
      null
    );
    expect(r).toEqual([
      { operacionId: "op1", texto: "2 × Cerveza Patagonia", subtotal: 28000, unidades: 2 },
      { operacionId: "op2", texto: "1 × Brownie", subtotal: 10000 },
    ]);
  });

  it("un ítem y su espejo de anulación (misma venta) dan una sola línea con la cantidad neta", () => {
    const r = lineasCorregibles(
      [item({ productoId: "ce", productoNombre: "Cerveza", operacionId: "op1", cantidad: 3, precioUnitario: 5000 }), item({ productoId: "ce", productoNombre: "Cerveza", operacionId: "op1", cantidad: -1, precioUnitario: 5000 })],
      null
    );
    expect(r).toEqual([{ operacionId: "op1", texto: "2 × Cerveza", subtotal: 10000, unidades: 2 }]);
  });

  it("una promo es UNA sola línea (el título y lo cobrado por todos sus componentes), aunque tenga dos ventas", () => {
    const promo = { promoCuentaId: "pc1", titulo: "Menú del día" };
    const r = lineasCorregibles(
      [
        item({ productoId: "a", productoNombre: "Milanesa", operacionId: "opA", precioUnitario: 7000, promo }),
        item({ productoId: "b", productoNombre: "Flan", operacionId: "opB", precioUnitario: 3000, promo }),
        item({ productoId: "c", productoNombre: "Café", operacionId: "opC", precioUnitario: 4000 }),
      ],
      null
    );
    expect(r).toEqual([
      { operacionId: "opA", texto: "Menú del día", subtotal: 10000, sinCorreccionPorUnidades: "PROMO" },
      { operacionId: "opC", texto: "1 × Café", subtotal: 4000 },
    ]);
  });

  it("el descuento de cliente se aplica como en el ticket", () => {
    const r = lineasCorregibles([item({ productoId: "ca", productoNombre: "Café", operacionId: "op1", precioUnitario: 4000, precioCartaUnitario: 4000 })], 10);
    expect(r).toEqual([{ operacionId: "op1", texto: "1 × Café", subtotal: 3600 }]);
  });

  it("E1: solo una línea suelta de 2 o más unidades enteras se corrige por unidades; una línea con adicionales avisa que se corrige entera", () => {
    const r = lineasCorregibles(
      [
        item({ id: "p", productoId: "ca", productoNombre: "Café", operacionId: "opCafe", cantidad: 2, precioUnitario: 4000 }),
        item({ id: "a", lineaPadreId: "p", productoId: "le", productoNombre: "Leche de almendras", operacionId: "opAdicional", cantidad: 2, precioUnitario: 500 }),
        item({ productoId: "br", productoNombre: "Brownie", operacionId: "opBrownie", cantidad: 1, precioUnitario: 10000 }),
        item({ productoId: "ce", productoNombre: "Cerveza", operacionId: "opCerveza", cantidad: 3, precioUnitario: 14000 }),
      ],
      null
    );
    expect(r).toEqual([
      { operacionId: "opCafe", texto: "2 × Café", subtotal: 9000, sinCorreccionPorUnidades: "ADICIONALES" },
      { operacionId: "opBrownie", texto: "1 × Brownie", subtotal: 10000 },
      { operacionId: "opCerveza", texto: "3 × Cerveza", subtotal: 42000, unidades: 3 },
    ]);
  });

  it("sin ítems vigentes no hay nada que corregir", () => {
    expect(lineasCorregibles([], null)).toEqual([]);
    expect(lineasCorregibles([item({ productoId: "x", productoNombre: "X", operacionId: "op1", anuladaEn: new Date() })], null)).toEqual([]);
  });
});
