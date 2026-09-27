import { describe, expect, it } from "vitest";
import { guardComandoCerrarCuenta, guardComandoEmitirBoletaCorregida, MENSAJE_CUENTA_NO_ENCONTRADA } from "../../../../src/core/features/cuentas/cuenta.guard";

/** Guard del comando «cerrar la cuenta» (src/core/features/cuentas/cuenta.guard.ts; Task #41, Fase M12a): formato, puro. */
describe("guardComandoCerrarCuenta", () => {
  it("un cuentaId string pasa tal cual (exista o no: eso lo decide el caso de uso)", () => {
    expect(guardComandoCerrarCuenta({ cuentaId: "cta-1" })).toEqual({ ok: true, valor: { cuentaId: "cta-1" } });
    expect(guardComandoCerrarCuenta({ cuentaId: "" })).toEqual({ ok: true, valor: { cuentaId: "" } });
  });

  it.each([undefined, null, 42, { id: "cta-1" }])("cuentaId %j: el mismo mensaje que «no encontrada», sin llegar a la base", (cuentaId) => {
    expect(guardComandoCerrarCuenta({ cuentaId })).toEqual({ ok: false, codigo: "formato", mensaje: "No se encontró esa cuenta en esta sucursal." });
  });

  it("sin entrada: rechaza igual", () => {
    expect(guardComandoCerrarCuenta(undefined)).toMatchObject({ ok: false, codigo: "formato", mensaje: MENSAJE_CUENTA_NO_ENCONTRADA });
  });
});

/** Guard del comando «emitir boleta corregida» (Task #41, Fase M12b): solo el formato del `cuentaId`; el motivo pasa crudo. */
describe("guardComandoEmitirBoletaCorregida", () => {
  it("un cuentaId string pasa, con el motivo TAL CUAL (sin recortar ni validar: eso lo hace el caso de uso, después de las guardas de estado)", () => {
    expect(guardComandoEmitirBoletaCorregida({ cuentaId: "cta-1", motivo: "  No quiso el flan  " })).toEqual({ ok: true, valor: { cuentaId: "cta-1", motivo: "  No quiso el flan  " } });
    expect(guardComandoEmitirBoletaCorregida({ cuentaId: "cta-1", motivo: "" })).toEqual({ ok: true, valor: { cuentaId: "cta-1", motivo: "" } });
    expect(guardComandoEmitirBoletaCorregida({ cuentaId: "cta-1" })).toEqual({ ok: true, valor: { cuentaId: "cta-1", motivo: undefined } });
  });

  it.each([undefined, null, 42, { id: "cta-1" }])("cuentaId %j: el mismo mensaje que «no encontrada», sin llegar a la base", (cuentaId) => {
    expect(guardComandoEmitirBoletaCorregida({ cuentaId, motivo: "x" })).toEqual({ ok: false, codigo: "formato", mensaje: MENSAJE_CUENTA_NO_ENCONTRADA });
  });

  it("sin entrada: rechaza igual", () => {
    expect(guardComandoEmitirBoletaCorregida(null)).toMatchObject({ ok: false, codigo: "formato", mensaje: MENSAJE_CUENTA_NO_ENCONTRADA });
  });
});
