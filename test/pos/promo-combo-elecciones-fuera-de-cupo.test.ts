import { describe, expect, it } from "vitest";
import { validarEleccionPromo, type CupoPromoDefinicion, type EleccionDeCupo } from "../../src/core/pos/promo-combo";

/**
 * S-01 (O.50 de docs/pureza-integracion.md), tanda T1 del plan de endurecimiento de seguridad: la elección de una promo armable NO puede traer nada
 * que no sea un cupo de la promo. El ataque (K1 del informe B): `validarEleccionPromo` recorría los CUPOS y tomaba la elección de cada uno por un `Map`
 * (la sección repetida pisaba a la anterior), pero el caso de uso aplanaba TODAS las elecciones recibidas: una elección de una sección que no es cupo, o
 * una primera elección de una sección repetida, entraba sin validar y se prorrateaba a $0,01 la unidad (cualquier producto de la empresa, incluso una MP).
 *
 * Sin base: la forma del ataque contra la regla pura. El mismo ataque de punta a punta (con filas) está en `promo-elecciones-fuera-de-cupo-action.test.ts`.
 */

function cupoEmpanadas(over: Partial<CupoPromoDefinicion> = {}): CupoPromoDefinicion {
  return { seccionCartaId: "sec-empanadas", nombreSeccion: "Empanadas", cantidadMinima: 2, cantidadMaximaCupo: 2, elegibles: new Set(["emp-carne", "emp-jyq"]), ...over };
}

const eleccionValida: EleccionDeCupo = { seccionCartaId: "sec-empanadas", elegidos: [{ productoId: "emp-carne", cantidad: 2 }] };

describe("S-01: validarEleccionPromo rechaza lo que no es un cupo de la promo", () => {
  it("control: la elección completa y dentro de los cupos pasa", () => {
    expect(validarEleccionPromo([cupoEmpanadas()], [eleccionValida])).toEqual({ ok: true });
  });

  it("ataque 1: una segunda elección de una sección que NO es cupo (30 unidades de una MP) se rechaza", () => {
    const r = validarEleccionPromo([cupoEmpanadas()], [eleccionValida, { seccionCartaId: "sec-que-no-es-cupo", elegidos: [{ productoId: "mp-harina", cantidad: 30 }] }]);
    expect(r.ok).toBe(false);
  });

  it("ataque 2: la MISMA sección dos veces (la primera con 30 de cualquier cosa, la segunda válida) se rechaza", () => {
    const r = validarEleccionPromo([cupoEmpanadas()], [{ seccionCartaId: "sec-empanadas", elegidos: [{ productoId: "mp-harina", cantidad: 30 }] }, eleccionValida]);
    expect(r.ok).toBe(false);
  });

  it("la misma sección dos veces, las dos válidas por separado, también se rechaza (una elección por cupo)", () => {
    const r = validarEleccionPromo([cupoEmpanadas({ cantidadMinima: 1, cantidadMaximaCupo: 4 })], [eleccionValida, { seccionCartaId: "sec-empanadas", elegidos: [{ productoId: "emp-jyq", cantidad: 1 }] }]);
    expect(r.ok).toBe(false);
  });

  it("un mismo producto dos veces dentro del mismo cupo se rechaza (la cantidad va en una sola fila)", () => {
    const r = validarEleccionPromo([cupoEmpanadas()], [{ seccionCartaId: "sec-empanadas", elegidos: [{ productoId: "emp-carne", cantidad: 1 }, { productoId: "emp-carne", cantidad: 1 }] }]);
    expect(r.ok).toBe(false);
  });

  it("la forma rota se rechaza SIN lanzar (fallo cerrado, nunca un 500)", () => {
    const rotas: unknown[] = [
      null,
      "texto",
      42,
      { seccionCartaId: 7, elegidos: [] },
      { seccionCartaId: "sec-empanadas" },
      { seccionCartaId: "sec-empanadas", elegidos: { productoId: "emp-carne", cantidad: 2 } },
      { seccionCartaId: "sec-empanadas", elegidos: [null] },
      { seccionCartaId: "sec-empanadas", elegidos: [{ productoId: 12, cantidad: 2 }] },
      { seccionCartaId: "sec-empanadas", elegidos: [{ productoId: "emp-carne", cantidad: "2" }] },
      { seccionCartaId: "sec-empanadas", elegidos: [{ productoId: "emp-carne", cantidad: Number.NaN }] },
      { seccionCartaId: "sec-empanadas", elegidos: [{ productoId: "emp-carne", cantidad: Number.POSITIVE_INFINITY }] },
    ];
    for (const rota of rotas) {
      const lista = [eleccionValida, rota] as unknown as EleccionDeCupo[];
      expect(() => validarEleccionPromo([cupoEmpanadas()], lista)).not.toThrow();
      expect(validarEleccionPromo([cupoEmpanadas()], lista).ok).toBe(false);
    }
  });

  it("una elección que no es una lista se rechaza sin lanzar", () => {
    expect(validarEleccionPromo([cupoEmpanadas()], undefined as unknown as EleccionDeCupo[]).ok).toBe(false);
    expect(validarEleccionPromo([cupoEmpanadas()], { 0: eleccionValida } as unknown as EleccionDeCupo[]).ok).toBe(false);
  });

  it("un cupo sin nada elegido sigue contando como vacío (solo pasa con mínimo 0): no hace falta una elección vacía", () => {
    expect(validarEleccionPromo([cupoEmpanadas({ cantidadMinima: 0 })], [])).toEqual({ ok: true });
    expect(validarEleccionPromo([cupoEmpanadas({ cantidadMinima: 0 })], [{ seccionCartaId: "sec-empanadas", elegidos: [] }])).toEqual({ ok: true });
  });
});
