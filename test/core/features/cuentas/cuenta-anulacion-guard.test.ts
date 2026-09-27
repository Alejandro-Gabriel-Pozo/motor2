import { describe, expect, it } from "vitest";
import { guardComandoAnularItemEnviado, guardComandoAnularPromoEnviada, MENSAJE_ITEM_NO_ENCONTRADO, MENSAJE_PROMO_NO_ENCONTRADA } from "../../../../src/core/features/cuentas/cuenta-anulacion.guard";

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

/** Guard del comando «anular una promo ya enviada» (mismo archivo; Task #41, Fase M12d): formato, puro. */
describe("guardComandoAnularPromoEnviada", () => {
  it("un promoCuentaId string pasa, con el motivo TAL CUAL (sin validar: eso lo hace el caso de uso, después de las guardas de estado)", () => {
    expect(guardComandoAnularPromoEnviada({ promoCuentaId: "pc-1", motivo: "  Se cayó la mesa  " })).toEqual({ ok: true, valor: { promoCuentaId: "pc-1", motivo: "  Se cayó la mesa  " } });
    expect(guardComandoAnularPromoEnviada({ promoCuentaId: "", motivo: 42 })).toEqual({ ok: true, valor: { promoCuentaId: "", motivo: 42 } });
    expect(guardComandoAnularPromoEnviada({ promoCuentaId: "pc-1" })).toEqual({ ok: true, valor: { promoCuentaId: "pc-1", motivo: undefined } });
  });

  it.each([undefined, null, 42, { id: "pc-1" }])("promoCuentaId %j: el mismo mensaje que «no encontrada», sin llegar a la base", (promoCuentaId) => {
    expect(guardComandoAnularPromoEnviada({ promoCuentaId, motivo: "x" })).toEqual({
      ok: false,
      codigo: "formato",
      mensaje: "No se encontró esa promo en esta sucursal.",
    });
  });

  it("sin entrada: rechaza igual", () => {
    expect(guardComandoAnularPromoEnviada(undefined)).toMatchObject({ ok: false, codigo: "formato", mensaje: MENSAJE_PROMO_NO_ENCONTRADA });
    expect(guardComandoAnularPromoEnviada(null)).toMatchObject({ ok: false, codigo: "formato", mensaje: MENSAJE_PROMO_NO_ENCONTRADA });
  });
});
