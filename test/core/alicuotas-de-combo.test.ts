import { describe, expect, it } from "vitest";
import { revisarAlicuotasDeCombo } from "../../src/core/pos/alicuotas-de-combo";

/**
 * GO-3 (ADR-032, D-2), paso D1: un combo no mezcla alícuotas de IVA DECLARADAS distintas (`COMBO_ALICUOTAS_DISTINTAS`); una sin declarar es un aviso, no un bloqueo.
 * Mutación demostrada: tratar la alícuota sin declarar como distinta (cae «sin declarar es un aviso»).
 */
describe("revisarAlicuotasDeCombo", () => {
  it("todas al 21 %: ok, con la alícuota común y sin avisos", () => {
    expect(revisarAlicuotasDeCombo([{ productoId: "a", nombre: "Milanesa", alicuota: "IVA_21" }, { productoId: "b", nombre: "Agua", alicuota: "IVA_21" }])).toEqual({ ok: true, alicuota: "IVA_21", sinDeclarar: [] });
  });

  it("dos declaradas distintas: se bloquea nombrando un producto de cada una", () => {
    const r = revisarAlicuotasDeCombo([
      { productoId: "a", nombre: "Milanesa", alicuota: "IVA_21" },
      { productoId: "c", nombre: "Pan", alicuota: null },
      { productoId: "b", nombre: "Libro", alicuota: "IVA_10_5" },
    ]);
    expect(r).toMatchObject({ ok: false, codigo: "COMBO_ALICUOTAS_DISTINTAS" });
    if (!r.ok) expect(r.mensaje).toMatch(/«Milanesa» y «Libro»/);
  });

  it("sin declarar es un aviso, no un bloqueo (una vez por producto); ninguna declarada da alícuota null; sin componentes, ok", () => {
    expect(revisarAlicuotasDeCombo([{ productoId: "a", nombre: "Milanesa", alicuota: "IVA_21" }, { productoId: "c", nombre: "Pan", alicuota: null }, { productoId: "c", nombre: "Pan", alicuota: null }])).toEqual({
      ok: true,
      alicuota: "IVA_21",
      sinDeclarar: [{ productoId: "c", nombre: "Pan" }],
    });
    expect(revisarAlicuotasDeCombo([{ productoId: "c", nombre: "Pan", alicuota: null }])).toEqual({ ok: true, alicuota: null, sinDeclarar: [{ productoId: "c", nombre: "Pan" }] });
    expect(revisarAlicuotasDeCombo([])).toEqual({ ok: true, alicuota: null, sinDeclarar: [] });
  });
});
