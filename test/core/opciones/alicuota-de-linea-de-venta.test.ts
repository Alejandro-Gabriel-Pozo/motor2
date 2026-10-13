import { describe, expect, it } from "vitest";
import { alicuotaDeLineaDeVenta } from "../../../src/core/fiscal/alicuota-de-linea-de-venta";
import { ALICUOTAS_IVA } from "../../../src/core/fiscal/iva";

/**
 * GO-0b (diseño §2.12): la alícuota de IVA de una línea. Una línea común usa la de su producto; un ADICIONAL usa la del producto de su línea PADRE; sin declarar es un
 * resultado explícito (la emisión fiscal falla cerrada más adelante: acá solo se devuelve el dato).
 */
describe("alicuotaDeLineaDeVenta", () => {
  it("una línea común usa la alícuota de su producto", () => {
    expect(alicuotaDeLineaDeVenta({ alicuotaDelProducto: "IVA_21" })).toEqual({ declarada: true, alicuota: "IVA_21" });
    expect(alicuotaDeLineaDeVenta({ alicuotaDelProducto: "IVA_10_5", padre: null })).toEqual({ declarada: true, alicuota: "IVA_10_5" });
    expect(alicuotaDeLineaDeVenta({ alicuotaDelProducto: "EXENTO", padre: undefined })).toEqual({ declarada: true, alicuota: "EXENTO" });
  });

  it("un adicional usa la del producto de su línea padre, aunque su producto de respaldo tenga otra", () => {
    expect(alicuotaDeLineaDeVenta({ alicuotaDelProducto: "IVA_21", padre: { alicuotaDelProducto: "IVA_10_5" } })).toEqual({ declarada: true, alicuota: "IVA_10_5" });
    expect(alicuotaDeLineaDeVenta({ alicuotaDelProducto: null, padre: { alicuotaDelProducto: "IVA_21" } })).toEqual({ declarada: true, alicuota: "IVA_21" });
  });

  it("alícuota sin declarar (null) → resultado explícito «sin declarar», nunca una alícuota supuesta", () => {
    expect(alicuotaDeLineaDeVenta({ alicuotaDelProducto: null })).toEqual({ declarada: false });
    expect(alicuotaDeLineaDeVenta({ alicuotaDelProducto: null, padre: null })).toEqual({ declarada: false });
  });

  it("un adicional cuyo padre no tiene alícuota declarada queda sin declarar, aunque el producto del adicional la tenga", () => {
    expect(alicuotaDeLineaDeVenta({ alicuotaDelProducto: "IVA_21", padre: { alicuotaDelProducto: null } })).toEqual({ declarada: false });
  });

  it("devuelve cada código de la lista cerrada tal cual, también el que vale 0 (IVA_0, EXENTO, NO_GRAVADO no son «sin declarar»)", () => {
    for (const alicuota of ALICUOTAS_IVA) {
      expect(alicuotaDeLineaDeVenta({ alicuotaDelProducto: alicuota })).toEqual({ declarada: true, alicuota });
      expect(alicuotaDeLineaDeVenta({ alicuotaDelProducto: null, padre: { alicuotaDelProducto: alicuota } })).toEqual({ declarada: true, alicuota });
    }
  });
});
