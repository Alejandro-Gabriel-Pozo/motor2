import { describe, expect, it } from "vitest";
import { validarNroFactura } from "@/core/datos/nro-factura";
import { LARGO_MAXIMO_NRO_FACTURA } from "@/core/texto";

// Sin base de datos: validarNroFactura es pura. Misma decisión que test/core/nro-factura.test.ts: texto libre del proveedor,
// sin charset propio — solo se exige largo máximo y al menos una letra o un número.
describe("validarNroFactura", () => {
  it.each(["A-0001-00001234", "#12/345*", "-0001", "0001-00000042", "Fc. B 12", "Nº 7"])("acepta %j tal cual (recortado)", (nro) => {
    expect(validarNroFactura(nro)).toEqual({ ok: true, valor: nro });
  });

  it("recorta los espacios", () => {
    expect(validarNroFactura("  A-1  ")).toEqual({ ok: true, valor: "A-1" });
  });

  it("vacío o solo espacios → null (compra sin número)", () => {
    for (const v of ["", "   ", undefined, null]) expect(validarNroFactura(v)).toEqual({ ok: true, valor: null });
  });

  it.each(["---", "...", "#*#", "/", "- -"])("rechaza %j: sin ninguna letra ni número", (nro) => {
    expect(validarNroFactura(nro)).toEqual({
      ok: false,
      codigo: "sin_alfanumerico",
      mensaje: "El número de factura tiene que tener al menos una letra o un número.",
    });
  });

  it("acepta hasta el máximo; uno más da el mensaje exacto de hoy", () => {
    expect(validarNroFactura("A".repeat(LARGO_MAXIMO_NRO_FACTURA))).toMatchObject({ ok: true });
    expect(validarNroFactura("A".repeat(LARGO_MAXIMO_NRO_FACTURA + 1))).toEqual({
      ok: false,
      codigo: "largo",
      mensaje: `El número de factura no puede superar los ${LARGO_MAXIMO_NRO_FACTURA} caracteres.`,
    });
    expect(LARGO_MAXIMO_NRO_FACTURA).toBe(60);
  });
});
