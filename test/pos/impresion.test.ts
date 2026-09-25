import { describe, expect, it } from "vitest";
import type { BoletaDeCuenta } from "../../src/core/pos/boleta";
import type { ComandaDeEnvio } from "../../src/core/pos/comanda";
import { resolverImpresion } from "../../src/core/pos/impresion";

/** Qué imprimir después de una acción (src/core/pos/impresion.ts, docs/plan-imprimir-comanda-y-boleta-2026-09-25.md B2/B4): núcleo puro. */

function comanda(numero: number, itemIds: string[], anulaciones: ComandaDeEnvio["anulaciones"] = []): ComandaDeEnvio {
  return { numero, itemIds, tomo: ["Juan"], lineas: itemIds.map((itemId) => ({ itemId, producto: `P-${itemId}`, cantidad: 1 })), anulaciones };
}

describe("resolverImpresion: envío a cocina", () => {
  it("el envío que el servidor confirmó como nuevo (`numeroEnvio`) se imprime como comanda", () => {
    const envio2 = comanda(2, ["b", "c"]);
    expect(resolverImpresion({ boletas: [], comandas: [comanda(1, ["a"]), envio2] }, { tipo: "envio", numero: 2 })).toEqual({
      accion: "imprimir",
      documento: { tipo: "comanda", comanda: envio2 },
    });
  });

  it("antes del refresco (el envío todavía no está en pantalla) espera", () => {
    expect(resolverImpresion({ boletas: [], comandas: [comanda(1, ["a"])] }, { tipo: "envio", numero: 2 })).toEqual({ accion: "esperar" });
  });
});

describe("resolverImpresion: anulación", () => {
  const primera = { id: "e1", itemId: "a", producto: "Milanesa", cantidad: 1, motivo: "Una menos", por: "Ana", quedan: 2 };
  const segunda = { id: "e2", itemId: "a", producto: "Milanesa", cantidad: 1, motivo: "Otra menos", por: "Ana", quedan: 1 };

  it("la anulación nueva del ítem (no estaba entre `espejosAntes`) se imprime, con lo que quedó", () => {
    const envio = comanda(1, ["a"], [primera, segunda]);
    const r = resolverImpresion({ boletas: [], comandas: [envio] }, { tipo: "anulacion", itemId: "a", espejosAntes: ["e1"] });
    expect(r).toEqual({ accion: "imprimir", documento: { tipo: "anulacion", comanda: envio, anulacion: segunda } });
    expect(r.accion === "imprimir" && r.documento.tipo === "anulacion" && r.documento.anulacion.quedan).toBe(1);
  });

  it("mientras la anulación nueva no llegue, espera", () => {
    expect(resolverImpresion({ boletas: [], comandas: [comanda(1, ["a"], [primera])] }, { tipo: "anulacion", itemId: "a", espejosAntes: ["e1"] })).toEqual({ accion: "esperar" });
  });
});

describe("resolverImpresion: boleta de cierre", () => {
  const boleta = (cuentaId: string, ventaAnulada = false): BoletaDeCuenta => ({
    cuentaId,
    cerradaEn: new Date("2026-09-25T18:10:00Z"),
    mesero: "Juan",
    lineas: [{ producto: "Milanesa", cantidad: 2, precioUnitario: 9000, subtotal: 18000 }],
    total: 18000,
    ventaAnulada,
    numero: null,
    corrigeA: null,
    estado: ventaAnulada ? "anulada" : "vigente",
  });

  it("presente en «Cuentas cerradas»: se imprime", () => {
    const b = boleta("c1");
    expect(resolverImpresion({ comandas: [], boletas: [boleta("c0"), b] }, { tipo: "boleta", cuentaId: "c1" })).toEqual({ accion: "imprimir", documento: { tipo: "boleta", boleta: b } });
  });

  it("todavía ausente (antes del refresco): espera", () => {
    expect(resolverImpresion({ comandas: [], boletas: [boleta("c0")] }, { tipo: "boleta", cuentaId: "c1" })).toEqual({ accion: "esperar" });
  });

  it("con la venta anulada: descarta (no se imprime el comprobante de una venta revertida)", () => {
    expect(resolverImpresion({ comandas: [], boletas: [boleta("c1", true)] }, { tipo: "boleta", cuentaId: "c1" })).toEqual({ accion: "descartar" });
  });
});
