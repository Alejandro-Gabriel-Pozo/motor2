import { describe, expect, it } from "vitest";
import { armarTicketImpresoEn, armarTicketVigente, armarTicketsDeCuentas, estadoDeTicket, type CuentaCerradaLeida, type ItemConVenta, type VersionDeVenta } from "../../src/core/pos/ticket";

/** E1 (docs/diseno-correccion-por-ajuste-2026-11-06.md): el ticket vigente toma la cantidad de la venta que REEMPLAZA a la original. Mesa 1 con datos reales de la maqueta. */
const T0 = new Date("2026-11-06T13:00:00Z"); // se cierra la cuenta e imprime 566-A
const T1 = new Date("2026-11-06T13:30:00Z"); // se corrige: 1 de 2 cervezas, ejemplar 566-B
const T2 = new Date("2026-11-06T14:00:00Z"); // después, se anula la cerveza que quedó
const AHORA = new Date("2026-11-06T15:00:00Z");

const item = (nombre: string, cantidad: number, precio: number, operacionId: string, versiones?: VersionDeVenta[], anuladaEn: Date | null = null): ItemConVenta => ({
  productoId: nombre,
  productoNombre: nombre,
  cantidad,
  precioUnitario: precio,
  operacionId,
  anuladaEn,
  ...(versiones ? { versionesDeLaVenta: versiones } : {}),
});

const brownie = item("Brownie", 1, 10000, "op-brownie");
const cafe = item("Café", 2, 4000, "op-cafe");
const cerveza2 = (versiones?: VersionDeVenta[], anuladaEn: Date | null = null) => item("Cerveza Patagonia", 2, 14000, "op-cerveza", versiones, anuladaEn);

describe("ticket vigente con «reemplaza a»", () => {
  it("sin corrección: el ticket de siempre (2 cervezas + brownie + 2 cafés = $46.000)", () => {
    const t = armarTicketVigente([cerveza2(), brownie, cafe], AHORA);
    expect(t.total).toBe(46000);
    expect(t.lineas.map((l) => `${l.cantidad} × ${l.producto}`)).toEqual(["2 × Cerveza Patagonia", "1 × Brownie", "2 × Café"]);
  });

  it("quitar 1 de 2 cervezas: la venta A queda marcada y B vende 1: el ticket vigente muestra 1 cerveza y $32.000", () => {
    const versiones: VersionDeVenta[] = [{ cantidad: 2, anuladaEn: T1 }, { cantidad: 1, anuladaEn: null }];
    const t = armarTicketVigente([cerveza2(versiones, T1), brownie, cafe], AHORA);
    expect(t.total).toBe(32000);
    expect(t.lineas.find((l) => l.producto === "Cerveza Patagonia")).toMatchObject({ cantidad: 1, precioUnitario: 14000, subtotal: 14000 });
  });

  it("el ticket 566-A impreso antes de corregir se reconstruye como se imprimió ($46.000), el 566-B como quedó ($32.000)", () => {
    const versiones: VersionDeVenta[] = [{ cantidad: 2, anuladaEn: T1 }, { cantidad: 1, anuladaEn: null }];
    const items = [cerveza2(versiones, T1), brownie, cafe];
    expect(armarTicketImpresoEn(items, T0).total).toBe(46000);
    expect(armarTicketImpresoEn(items, T1).total).toBe(32000);
  });

  it("dos correcciones seguidas (4 → 3 → 1): cada instante ve la cantidad de la versión que regía", () => {
    const versiones: VersionDeVenta[] = [{ cantidad: 4, anuladaEn: T1 }, { cantidad: 3, anuladaEn: T2 }, { cantidad: 1, anuladaEn: null }];
    const items = [item("Cerveza Patagonia", 4, 14000, "op-cerveza", versiones, T1)];
    expect(armarTicketImpresoEn(items, T0).total).toBe(56000);
    expect(armarTicketImpresoEn(items, T1).total).toBe(42000);
    expect(armarTicketVigente(items, AHORA).total).toBe(14000);
  });

  it("si la versión que quedó se anula entera, la línea desaparece y el ticket queda «anulada»", () => {
    const versiones: VersionDeVenta[] = [{ cantidad: 2, anuladaEn: T1 }, { cantidad: 1, anuladaEn: T2 }];
    const items = [cerveza2(versiones, T1)];
    expect(armarTicketVigente(items, AHORA)).toEqual({ lineas: [], total: 0 });
    expect(estadoDeTicket(items, T1)).toBe("anulada");
  });

  it("estado del ejemplar: el 566-B emitido en la corrección está «vigente»; si después se anula otra línea, «desactualizada»", () => {
    const versiones: VersionDeVenta[] = [{ cantidad: 2, anuladaEn: T1 }, { cantidad: 1, anuladaEn: null }];
    expect(estadoDeTicket([cerveza2(versiones, T1), brownie, cafe], T1)).toBe("vigente");
    // Una corrección posterior a la impresión del 566-A deja ese ejemplar desactualizado.
    expect(estadoDeTicket([cerveza2(versiones, T1), brownie, cafe], T0)).toBe("desactualizada");
    expect(estadoDeTicket([cerveza2(versiones, T1), { ...brownie, anuladaEn: T2 }, cafe], T1)).toBe("desactualizada");
  });

  it("una línea corregida no suma la cantidad dos veces aunque tenga ítem original y espejo", () => {
    const versiones: VersionDeVenta[] = [{ cantidad: 2, anuladaEn: T1 }, { cantidad: 1, anuladaEn: null }];
    const original = { ...item("Cerveza Patagonia", 3, 14000, "op-cerveza", versiones, T1), id: "i1" };
    const espejo = { ...item("Cerveza Patagonia", -1, 14000, "op-cerveza", versiones, T1), id: "i2", anulaAItemId: "i1" };
    expect(armarTicketVigente([original, espejo], AHORA).lineas).toMatchObject([{ cantidad: 1, subtotal: 14000 }]);
  });
});

describe("armarTicketsDeCuentas con una venta reemplazada", () => {
  const cuenta = (versiones?: VersionDeVenta[]): CuentaCerradaLeida => ({
    id: "c1",
    cerradaEn: T0,
    descuentoPorcentaje: null,
    abiertaPor: { name: "Marta", email: "marta@ejemplo.com" },
    cliente: null,
    items: [
      { productoId: "cerveza", producto: { nombre: "Cerveza Patagonia", modoDeVenta: "SIMPLE" }, cantidad: 2, precioUnitario: 14000, precioCartaUnitario: null, operacionId: "op-cerveza", operacion: { anuladaEn: T1, ...(versiones ? { versiones } : {}) }, promoCuenta: null },
      { productoId: "brownie", producto: { nombre: "Brownie", modoDeVenta: "SIMPLE" }, cantidad: 1, precioUnitario: 10000, precioCartaUnitario: null, operacionId: "op-brownie", operacion: { anuladaEn: null }, promoCuenta: null },
    ],
    ejemplaresTicket: [{ numero: 566, ejemplar: 2, emitidoEn: T1, corrigeA: { numero: 566, ejemplar: 1 } }],
  });

  it("con la corrección: ticket 566-B de $24.000, estado vigente, venta no marcada como anulada", () => {
    const [t] = armarTicketsDeCuentas([cuenta([{ cantidad: 2, anuladaEn: T1 }, { cantidad: 1, anuladaEn: null }])], AHORA);
    expect(t).toMatchObject({ total: 24000, estado: "vigente", ventaAnulada: false });
  });

  it("sin versiones (la venta se anuló sin reemplazo): el comportamiento de siempre, la línea no cuenta", () => {
    const [t] = armarTicketsDeCuentas([cuenta()], AHORA);
    expect(t).toMatchObject({ total: 10000, ventaAnulada: true });
  });
});
