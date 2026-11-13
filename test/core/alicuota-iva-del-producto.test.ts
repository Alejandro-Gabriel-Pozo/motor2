import { describe, expect, it } from "vitest";
import { ALICUOTAS_IVA } from "../../src/core/fiscal/iva";
import { alicuotaIvaDelProducto, guardAlicuotaIvaDelProducto } from "../../src/core/features/catalogo/productos.guard";

/**
 * Núcleo puro de la alícuota de IVA del producto (paso 13 de la auditoría 2026-11-12, `docs/diseno-alicuota-iva-del-producto-2026-11-12.md`; invariantes I1 e I2). Sin base: lo que decide
 * `guardAlicuotaIvaDelProducto` con lo que mandó el cliente. I1: el valor es de la lista cerrada `ALICUOTAS_IVA` o vacío (`null`, «sin declarar»); cualquier otro se rechaza. I2: la de venta solo en un PV,
 * la de compra solo en una MP.
 */
describe("guardAlicuotaIvaDelProducto", () => {
  describe("I1: lista cerrada o vacío", () => {
    it.each(ALICUOTAS_IVA)("%s se acepta como alícuota de venta de un PV y como alícuota de compra de una MP", (a) => {
      expect(guardAlicuotaIvaDelProducto({ tipo: "PV", alicuotaIvaVenta: a }).ok).toBe(true);
      expect(guardAlicuotaIvaDelProducto({ tipo: "MP", alicuotaIvaCompra: a }).ok).toBe(true);
    });

    it("vacío es «sin declarar»: `null` se acepta, y que no venga (`undefined`) también", () => {
      expect(guardAlicuotaIvaDelProducto({ tipo: "PV", alicuotaIvaVenta: null }).ok).toBe(true);
      expect(guardAlicuotaIvaDelProducto({ tipo: "MP", alicuotaIvaCompra: null }).ok).toBe(true);
      expect(guardAlicuotaIvaDelProducto({ tipo: "PV" }).ok).toBe(true);
      expect(guardAlicuotaIvaDelProducto({ tipo: "MP" }).ok).toBe(true);
    });

    const FUERA_DE_LA_LISTA: [string, unknown][] = [
      ["un texto que no es de la lista", "IVA_99"],
      ["el porcentaje a secas", "21"],
      ["una alícuota con otra grafía", "iva_21"],
      ["con un espacio", "IVA_21 "],
      ["texto vacío", ""],
      ["NO_CORRESPONDE (es de la venta, no del producto)", "NO_CORRESPONDE"],
      ["un número", 21],
      ["un booleano", false],
      ["un objeto", { valor: "IVA_21" }],
      ["una lista", ["IVA_21"]],
      ["un nombre heredado de Object", "constructor"],
    ];
    it.each(FUERA_DE_LA_LISTA)("rechaza %s, en el campo de venta y en el de compra", (_nombre, valor) => {
      const venta = guardAlicuotaIvaDelProducto({ tipo: "PV", alicuotaIvaVenta: valor });
      const compra = guardAlicuotaIvaDelProducto({ tipo: "MP", alicuotaIvaCompra: valor });
      expect(venta.ok).toBe(false);
      expect(compra.ok).toBe(false);
      if (!venta.ok) expect(venta.mensaje).toContain("no es una de las admitidas");
    });

    it("un valor fuera de la lista se rechaza aunque el campo sea el del tipo equivocado", () => {
      expect(guardAlicuotaIvaDelProducto({ tipo: "PV", alicuotaIvaCompra: "IVA_99" }).ok).toBe(false);
      expect(guardAlicuotaIvaDelProducto({ tipo: "MP", alicuotaIvaVenta: "IVA_99" }).ok).toBe(false);
    });
  });

  describe("I2: la de venta solo en un PV, la de compra solo en una MP", () => {
    it.each(ALICUOTAS_IVA)("%s de venta en una MP se rechaza con un mensaje claro", (a) => {
      const r = guardAlicuotaIvaDelProducto({ tipo: "MP", alicuotaIvaVenta: a });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.mensaje).toBe("El «IVA de venta» solo se carga en un producto de venta (PV).");
    });

    it.each(ALICUOTAS_IVA)("%s de compra en un PV se rechaza con un mensaje claro", (a) => {
      const r = guardAlicuotaIvaDelProducto({ tipo: "PV", alicuotaIvaCompra: a });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.mensaje).toBe("El «IVA de compra» solo se carga en una materia prima (MP).");
    });

    it("en el tipo equivocado `null` (sin declarar) no es un valor: no se rechaza, y el caso de uso no lo escribe", () => {
      expect(guardAlicuotaIvaDelProducto({ tipo: "MP", alicuotaIvaVenta: null }).ok).toBe(true);
      expect(guardAlicuotaIvaDelProducto({ tipo: "PV", alicuotaIvaCompra: null }).ok).toBe(true);
    });

    it("lista de lo permitido: ante un tipo que no es MP ni PV no se admite ninguna alícuota", () => {
      for (const tipo of ["ZZ", "", undefined, null, 1]) {
        expect(guardAlicuotaIvaDelProducto({ tipo, alicuotaIvaVenta: "IVA_21" }).ok, `venta con tipo ${String(tipo)}`).toBe(false);
        expect(guardAlicuotaIvaDelProducto({ tipo, alicuotaIvaCompra: "IVA_21" }).ok, `compra con tipo ${String(tipo)}`).toBe(false);
      }
    });

    it("las dos a la vez en un producto: la del tipo equivocado lo rechaza", () => {
      expect(guardAlicuotaIvaDelProducto({ tipo: "PV", alicuotaIvaVenta: "IVA_21", alicuotaIvaCompra: "IVA_21" }).ok).toBe(false);
      expect(guardAlicuotaIvaDelProducto({ tipo: "MP", alicuotaIvaVenta: "IVA_21", alicuotaIvaCompra: "IVA_21" }).ok).toBe(false);
    });
  });
});

describe("alicuotaIvaDelProducto (lo guardado, puesto en su tipo)", () => {
  it.each(ALICUOTAS_IVA)("%s se reconoce", (a) => {
    expect(alicuotaIvaDelProducto(a)).toBe(a);
  });

  it("lo que no es de la lista es «sin declarar» (`null`): nunca se supone una alícuota", () => {
    for (const valor of [null, undefined, "", "IVA_99", "NO_CORRESPONDE", 21, {}, "toString"]) expect(alicuotaIvaDelProducto(valor)).toBeNull();
  });
});
