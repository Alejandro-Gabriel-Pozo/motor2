import { describe, expect, it } from "vitest";
import type { ComandaDeEnvio } from "../../src/core/pos/comanda";
import { resolverImpresion } from "../../src/core/pos/impresion";

/** Qué imprimir después de una acción (src/core/pos/impresion.ts, docs/plan-imprimir-comanda-y-boleta-2026-09-25.md B2/B4): núcleo puro. */

function comanda(numero: number, itemIds: string[], anulaciones: ComandaDeEnvio["anulaciones"] = []): ComandaDeEnvio {
  return { numero, itemIds, tomo: ["Juan"], lineas: itemIds.map((itemId) => ({ itemId, producto: `P-${itemId}`, cantidad: 1 })), anulaciones };
}

describe("resolverImpresion: envío a cocina", () => {
  it("el envío nuevo (número mayor a `despuesDe`) con los ids pedidos se imprime como comanda", () => {
    const envio2 = comanda(2, ["b", "c"]);
    expect(resolverImpresion({ comandas: [comanda(1, ["a"]), envio2] }, { tipo: "envio", itemIds: ["b", "c"], despuesDe: 1 })).toEqual({
      accion: "imprimir",
      documento: { tipo: "comanda", comanda: envio2 },
    });
  });

  it("antes del refresco (los ids todavía no están en ningún envío) espera", () => {
    expect(resolverImpresion({ comandas: [comanda(1, ["a"])] }, { tipo: "envio", itemIds: ["b"], despuesDe: 1 })).toEqual({ accion: "esperar" });
  });

  it("si todos los ids ya estaban en envíos conocidos antes del clic (≤ `despuesDe`), descarta: no reimprime un envío viejo", () => {
    expect(resolverImpresion({ comandas: [comanda(1, ["a"]), comanda(2, ["b"])] }, { tipo: "envio", itemIds: ["a", "b"], despuesDe: 2 })).toEqual({ accion: "descartar" });
  });

  it("un envío parcial (solo algunos de los ids salieron en el envío nuevo) se imprime igual", () => {
    const envio2 = comanda(2, ["b"]);
    expect(resolverImpresion({ comandas: [comanda(1, ["a"]), envio2] }, { tipo: "envio", itemIds: ["a", "b"], despuesDe: 1 })).toEqual({
      accion: "imprimir",
      documento: { tipo: "comanda", comanda: envio2 },
    });
  });
});

describe("resolverImpresion: anulación", () => {
  const primera = { id: "e1", itemId: "a", producto: "Milanesa", cantidad: 1, motivo: "Una menos", por: "Ana", quedan: 2 };
  const segunda = { id: "e2", itemId: "a", producto: "Milanesa", cantidad: 1, motivo: "Otra menos", por: "Ana", quedan: 1 };

  it("la anulación nueva del ítem (no estaba entre `espejosAntes`) se imprime, con lo que quedó", () => {
    const envio = comanda(1, ["a"], [primera, segunda]);
    const r = resolverImpresion({ comandas: [envio] }, { tipo: "anulacion", itemId: "a", espejosAntes: ["e1"] });
    expect(r).toEqual({ accion: "imprimir", documento: { tipo: "anulacion", comanda: envio, anulacion: segunda } });
    expect(r.accion === "imprimir" && r.documento.tipo === "anulacion" && r.documento.anulacion.quedan).toBe(1);
  });

  it("mientras la anulación nueva no llegue, espera", () => {
    expect(resolverImpresion({ comandas: [comanda(1, ["a"], [primera])] }, { tipo: "anulacion", itemId: "a", espejosAntes: ["e1"] })).toEqual({ accion: "esperar" });
  });
});
