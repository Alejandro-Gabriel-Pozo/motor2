import { describe, expect, it } from "vitest";
import { guardComandoAnularItemEnviado, MENSAJE_ITEM_NO_ENCONTRADO } from "../../../../src/core/features/cuentas/cuenta-anulacion.guard";

/** Guard del comando «anular un ítem ya enviado» (src/core/features/cuentas/cuenta-anulacion.guard.ts; Task #41, Fase M12c): formato, puro. */
describe("guardComandoAnularItemEnviado", () => {
  it("un cuentaItemId string pasa, con cantidad, motivo y restanteVisto TAL CUAL (sin validar: eso lo hace el caso de uso, en el orden de siempre)", () => {
    expect(guardComandoAnularItemEnviado({ cuentaItemId: "it-1", cantidad: 2, motivo: "  Salió frío  ", restanteVisto: 3 })).toEqual({
      ok: true,
      valor: { cuentaItemId: "it-1", cantidad: 2, motivo: "  Salió frío  ", restanteVisto: 3 },
    });
    expect(guardComandoAnularItemEnviado({ cuentaItemId: "", cantidad: Number.NaN, motivo: "", restanteVisto: "3" })).toEqual({
      ok: true,
      valor: { cuentaItemId: "", cantidad: Number.NaN, motivo: "", restanteVisto: "3" },
    });
    expect(guardComandoAnularItemEnviado({ cuentaItemId: "it-1" })).toEqual({
      ok: true,
      valor: { cuentaItemId: "it-1", cantidad: undefined, motivo: undefined, restanteVisto: undefined },
    });
  });

  it.each([undefined, null, 42, { id: "it-1" }])("cuentaItemId %j: el mismo mensaje que «no encontrado», sin llegar a la base", (cuentaItemId) => {
    expect(guardComandoAnularItemEnviado({ cuentaItemId, cantidad: 1, motivo: "x", restanteVisto: 1 })).toEqual({
      ok: false,
      codigo: "formato",
      mensaje: "No se encontró ese ítem en esta sucursal.",
    });
  });

  it("sin entrada: rechaza igual", () => {
    expect(guardComandoAnularItemEnviado(undefined)).toMatchObject({ ok: false, codigo: "formato", mensaje: MENSAJE_ITEM_NO_ENCONTRADO });
    expect(guardComandoAnularItemEnviado(null)).toMatchObject({ ok: false, codigo: "formato", mensaje: MENSAJE_ITEM_NO_ENCONTRADO });
  });
});
