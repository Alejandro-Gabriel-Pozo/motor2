import { describe, expect, it } from "vitest";
import { guardComandoAnularVenta } from "../../../../src/core/features/ventas/venta.guard";

/** Guard del comando «anular una venta» (src/core/features/ventas/venta.guard.ts; Task #41, Fase M): formato, puro. */
describe("guardComandoAnularVenta", () => {
  it("un operacionId string pasa tal cual (exista o no: eso lo decide el caso de uso)", () => {
    expect(guardComandoAnularVenta({ operacionId: "op-1" })).toEqual({ ok: true, valor: { operacionId: "op-1" } });
    expect(guardComandoAnularVenta({ operacionId: "" })).toEqual({ ok: true, valor: { operacionId: "" } });
  });

  it.each([undefined, null, 42, { id: "op-1" }])("operacionId %j: el mismo mensaje que «no encontrada», sin llegar a la base", (operacionId) => {
    expect(guardComandoAnularVenta({ operacionId })).toEqual({ ok: false, codigo: "formato", mensaje: "No se encontró esa operación en esta sucursal." });
  });

  it("sin entrada: rechaza igual", () => {
    expect(guardComandoAnularVenta(undefined)).toMatchObject({ ok: false, codigo: "formato" });
  });
});
