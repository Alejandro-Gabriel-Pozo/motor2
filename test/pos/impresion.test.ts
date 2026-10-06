import { describe, expect, it } from "vitest";
import type { TicketDeCuenta } from "../../src/core/pos/ticket";
import type { ComandaDeEnvio } from "../../src/core/pos/comanda";
import { resolverImpresion } from "../../src/core/pos/impresion";

/** Qué imprimir después de una acción (src/core/pos/impresion.ts, docs/plan-imprimir-comanda-y-ticket-2026-09-25.md B2/B4): núcleo puro. */

function comanda(numero: number, itemIds: string[], anulaciones: ComandaDeEnvio["anulaciones"] = []): ComandaDeEnvio {
  return { numero, itemIds, tomo: ["Juan"], lineas: itemIds.map((itemId) => ({ itemId, producto: `P-${itemId}`, cantidad: 1 })), anulaciones };
}

describe("resolverImpresion: envío a cocina", () => {
  it("el envío que el servidor confirmó como nuevo (`numeroEnvio`) se imprime como comanda", () => {
    const envio2 = comanda(2, ["b", "c"]);
    expect(resolverImpresion({ tickets: [], comandas: [comanda(1, ["a"]), envio2] }, { tipo: "envio", numero: 2 })).toEqual({
      accion: "imprimir",
      documento: { tipo: "comanda", comanda: envio2 },
    });
  });

  it("antes del refresco (el envío todavía no está en pantalla) espera", () => {
    expect(resolverImpresion({ tickets: [], comandas: [comanda(1, ["a"])] }, { tipo: "envio", numero: 2 })).toEqual({ accion: "esperar" });
  });
});

describe("resolverImpresion: anulación", () => {
  const primera = { id: "e1", itemId: "a", producto: "Milanesa", cantidad: 1, motivo: "Una menos", por: "Ana", quedan: 2 };
  const segunda = { id: "e2", itemId: "a", producto: "Milanesa", cantidad: 1, motivo: "Otra menos", por: "Ana", quedan: 1 };

  it("la anulación nueva del ítem (no estaba entre `espejosAntes`) se imprime, con lo que quedó", () => {
    const envio = comanda(1, ["a"], [primera, segunda]);
    const r = resolverImpresion({ tickets: [], comandas: [envio] }, { tipo: "anulacion", itemId: "a", espejosAntes: ["e1"] });
    expect(r).toEqual({ accion: "imprimir", documento: { tipo: "anulacion", comanda: envio, anulacion: segunda } });
    expect(r.accion === "imprimir" && r.documento.tipo === "anulacion" && r.documento.anulacion.quedan).toBe(1);
  });

  it("mientras la anulación nueva no llegue, espera", () => {
    expect(resolverImpresion({ tickets: [], comandas: [comanda(1, ["a"], [primera])] }, { tipo: "anulacion", itemId: "a", espejosAntes: ["e1"] })).toEqual({ accion: "esperar" });
  });
});

describe("resolverImpresion: ticket de cierre", () => {
  const ticket = (cuentaId: string, ventaAnulada = false): TicketDeCuenta => ({
    cuentaId,
    cerradaEn: new Date("2026-09-25T18:10:00Z"),
    mesero: "Juan",
    lineas: [{ producto: "Milanesa", cantidad: 2, precioUnitario: 9000, subtotal: 18000 }],
    total: 18000,
    ventaAnulada,
    numero: null,
    corrigeA: null,
    estado: ventaAnulada ? "anulada" : "vigente",
    cliente: null,
  });

  it("presente en «Cuentas cerradas»: se imprime", () => {
    const b = ticket("c1");
    expect(resolverImpresion({ comandas: [], tickets: [ticket("c0"), b] }, { tipo: "ticket", cuentaId: "c1" })).toEqual({ accion: "imprimir", documento: { tipo: "ticket", ticket: b } });
  });

  it("todavía ausente (antes del refresco): espera", () => {
    expect(resolverImpresion({ comandas: [], tickets: [ticket("c0")] }, { tipo: "ticket", cuentaId: "c1" })).toEqual({ accion: "esperar" });
  });

  it("con la venta anulada: descarta (no se imprime el comprobante de una venta revertida)", () => {
    expect(resolverImpresion({ comandas: [], tickets: [ticket("c1", true)] }, { tipo: "ticket", cuentaId: "c1" })).toEqual({ accion: "descartar" });
  });
});

/** Ejemplar de corrección (docs/plan-numeracion-ticket-2026-09-25.md, paso 8): imprime el ejemplar que emitió `emitirTicketCorregido`. */
describe("resolverImpresion: ticket corregido", () => {
  const ticket = (ejemplar: number, estado: TicketDeCuenta["estado"] = "vigente"): TicketDeCuenta => ({
    cuentaId: "c1",
    cerradaEn: new Date("2026-09-25T18:10:00Z"),
    mesero: "Juan",
    lineas: [{ producto: "Milanesa", cantidad: 2, precioUnitario: 9000, subtotal: 18000 }],
    total: 18000,
    ventaAnulada: true,
    numero: { numero: 566, ejemplar },
    corrigeA: ejemplar > 1 ? { numero: 566, ejemplar: 1 } : null,
    estado,
    cliente: null,
  });
  const pedido = { tipo: "ticket-correccion", cuentaId: "c1", ejemplar: 2 } as const;

  it("cuando el refresco trae el ejemplar emitido (566-B, vigente): se imprime como corrección", () => {
    const b = ticket(2);
    expect(resolverImpresion({ comandas: [], tickets: [b] }, pedido)).toEqual({ accion: "imprimir", documento: { tipo: "ticket-correccion", ticket: b } });
  });

  it("antes del refresco (la cuenta todavía muestra el 566-A, o no aparece): espera", () => {
    expect(resolverImpresion({ comandas: [], tickets: [ticket(1, "desactualizada")] }, pedido)).toEqual({ accion: "esperar" });
    expect(resolverImpresion({ comandas: [], tickets: [] }, pedido)).toEqual({ accion: "esperar" });
  });

  it("si ya hay un ejemplar posterior, o el emitido dejó de estar vigente (otra anulación en el medio): descarta", () => {
    expect(resolverImpresion({ comandas: [], tickets: [ticket(3)] }, pedido)).toEqual({ accion: "descartar" });
    expect(resolverImpresion({ comandas: [], tickets: [ticket(2, "desactualizada")] }, pedido)).toEqual({ accion: "descartar" });
    expect(resolverImpresion({ comandas: [], tickets: [ticket(2, "anulada")] }, pedido)).toEqual({ accion: "descartar" });
  });
});
