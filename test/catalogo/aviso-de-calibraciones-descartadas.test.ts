import { describe, expect, it } from "vitest";
import { describirCalibracionDescartadaPorBase, describirMotivoDeCambioDeBase, unirEnCastellano } from "../../src/core/catalogo/public";

/** M3d: las piezas puras del aviso confirmado por el dueño (2026-11-17, «ok»): cómo se lista cada calibración descartada y cómo se unen en castellano. */
describe("aviso de calibraciones descartadas por el cambio de base (M3d)", () => {
  it("unirEnCastellano: «a», «a y b», «a, b y c»", () => {
    expect(unirEnCastellano([])).toBe("");
    expect(unirEnCastellano(["a"])).toBe("a");
    expect(unirEnCastellano(["a", "b"])).toBe("a y b");
    expect(unirEnCastellano(["a", "b", "c"])).toBe("a, b y c");
  });

  it("cada calibración se lista con la sucursal, el ingrediente y lo que valía (cantidad con su unidad)", () => {
    expect(describirCalibracionDescartadaPorBase({ sucursalNombre: "Norte", insumoNombre: "Bife de chorizo", cantidad: 0.32, mermaPorcentaje: 10, unidadNombre: "kg" })).toBe("«Norte» para «Bife de chorizo» (0,32 kg)");
  });

  it("sin cantidad calibrada muestra la merma; sin ninguno de los dos, nada entre paréntesis", () => {
    expect(describirCalibracionDescartadaPorBase({ sucursalNombre: "Sur", insumoNombre: "Tomate perita", cantidad: null, mermaPorcentaje: 12.5, unidadNombre: "kg" })).toBe("«Sur» para «Tomate perita» (merma 12,5 %)");
    expect(describirCalibracionDescartadaPorBase({ sucursalNombre: "Sur", insumoNombre: "Tomate perita", cantidad: null, mermaPorcentaje: null, unidadNombre: "kg" })).toBe("«Sur» para «Tomate perita»");
  });

  it("el motivo técnico de la auditoría nombra las dos bases", () => {
    expect(describirMotivoDeCambioDeBase({ baseVieja: "NETA", baseNueva: "BRUTA" })).toBe("la receta pasó de neta a bruta");
    expect(describirMotivoDeCambioDeBase({ baseVieja: "BRUTA", baseNueva: "NETA" })).toBe("la receta pasó de bruta a neta");
  });
});
