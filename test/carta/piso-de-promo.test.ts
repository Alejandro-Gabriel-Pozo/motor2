import { describe, expect, it } from "vitest";
import { mensajePisoDePromo, pisoDePrecioDePromo } from "../../src/core/carta/piso-de-promo";

/**
 * El piso de precio de una promo armable (Hito 4, H4C-2: las dos funciones salieron de `src/server/actions/carta/promos.ts` a `core/carta/piso-de-promo.ts`).
 * Puro, sin base: el cálculo ($0,01 por unidad con todos los cupos en su máximo) y el texto exacto del rechazo, que la huella de dinero del tramo C fija
 * también por las acciones.
 */
describe("piso de precio de una promo", () => {
  it("sin cupos no hay piso (la promo es informativa)", () => {
    expect(pisoDePrecioDePromo([])).toBeNull();
  });

  it("suma los máximos de todos los cupos: $0,01 por unidad del peor caso", () => {
    expect(pisoDePrecioDePromo([{ cantidadMaxima: 2 }, { cantidadMaxima: 1 }])).toEqual({ minimo: 0.03, unidades: 3 });
    expect(pisoDePrecioDePromo([{ cantidadMaxima: 5 }, { cantidadMaxima: 5 }])).toEqual({ minimo: 0.1, unidades: 10 });
    expect(pisoDePrecioDePromo([{ cantidadMaxima: 999 }, { cantidadMaxima: 999 }, { cantidadMaxima: 999 }])).toEqual({ minimo: 29.97, unidades: 2997 });
  });

  it("el mínimo queda redondeado a centavos (sin colas de coma flotante)", () => {
    const piso = pisoDePrecioDePromo([{ cantidadMaxima: 3 }, { cantidadMaxima: 4 }]);
    expect(piso).toEqual({ minimo: 0.07, unidades: 7 });
  });

  it("el mensaje nombra la promo, el precio, las unidades y el mínimo", () => {
    expect(mensajePisoDePromo("Menú del día", 0.02, { minimo: 0.03, unidades: 3 })).toBe(
      'El precio de "Menú del día" ($0.02) no alcanza el piso de $0,01 por unidad en el peor caso (3 unidades si se elige el máximo de cada cupo: hace falta al menos $0.03). Subí el precio o bajá los máximos.',
    );
  });
});
