import { describe, expect, it } from "vitest";
import { guardComandoCerrarCuenta, MENSAJE_CUENTA_NO_ENCONTRADA } from "../../../../src/core/features/cuentas/cuenta.guard";

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
