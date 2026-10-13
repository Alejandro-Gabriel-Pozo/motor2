import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { lineasDeVenta, type LineaDeVenta } from "../../src/core/pos/cuenta";

/**
 * Propiedad (fast-check, 1000 corridas) de GO-2b: `lineasDeVenta` se extendió con la huella y el padre (ADR-030), y SIN huella ni padre en la entrada su
 * salida tiene que ser EXACTAMENTE la de antes. El oráculo es una COPIA, en este test, de la versión anterior a GO-2b (la de `95411af`): si la nueva cambia
 * algo del camino de siempre (el orden, la suma, el filtro del neto, qué campos van), la propiedad cae. Los ítems traen `id` (como los manda el cierre) o no.
 */

function claveVieja(l: { productoId: string; precioUnitario: number; promoCuentaId?: string | null; precioCartaUnitario?: number | null }): string {
  const promoCuentaId = l.promoCuentaId ?? "";
  const lista = !promoCuentaId && l.precioCartaUnitario != null ? String(l.precioCartaUnitario) : "";
  return `${l.productoId}|${l.precioUnitario}|${promoCuentaId}${lista ? `|${lista}` : ""}`;
}

function redondearCantidad(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

/** La versión anterior a GO-2b, copiada tal cual. */
function lineasDeVentaViejas(items: readonly { productoId: string; cantidad: number; precioUnitario: number; promoCuentaId?: string | null; precioCartaUnitario?: number | null }[]): LineaDeVenta[] {
  const porClave = new Map<string, LineaDeVenta>();
  for (const item of items) {
    const promoCuentaId = item.promoCuentaId ?? undefined;
    const precioCartaUnitario = !promoCuentaId && item.precioCartaUnitario != null ? item.precioCartaUnitario : undefined;
    const clave = claveVieja({ productoId: item.productoId, precioUnitario: item.precioUnitario, promoCuentaId, precioCartaUnitario });
    const previa = porClave.get(clave);
    if (previa) previa.cantidad = redondearCantidad(previa.cantidad + item.cantidad);
    else {
      porClave.set(clave, {
        productoId: item.productoId,
        precioUnitario: item.precioUnitario,
        cantidad: redondearCantidad(item.cantidad),
        ...(promoCuentaId ? { promoCuentaId } : {}),
        ...(precioCartaUnitario !== undefined ? { precioCartaUnitario } : {}),
      });
    }
  }
  return [...porClave.values()].filter((l) => l.cantidad > 0);
}

const itemArb = fc.record(
  {
    id: fc.uuid(),
    productoId: fc.constantFrom("a", "b", "c"),
    cantidad: fc.oneof(fc.integer({ min: -3, max: 4 }), fc.constantFrom(0.25, -0.25, 1.5, 0.1, 0.2)),
    precioUnitario: fc.constantFrom(100, 120, 99.99, 0.01),
    promoCuentaId: fc.option(fc.constantFrom("promo-1", "promo-2"), { nil: null }),
    precioCartaUnitario: fc.option(fc.constantFrom(150, 110), { nil: null }),
    huellaOpciones: fc.constant(null),
    lineaPadreId: fc.constant(null),
  },
  { requiredKeys: ["productoId", "cantidad", "precioUnitario"] }
);

describe("lineasDeVenta sin huella ni padre (GO-2b): idéntica a la versión anterior", () => {
  it("para cualquier lista de ítems sin opciones, la salida es `toEqual` a la del oráculo", () => {
    fc.assert(
      fc.property(fc.array(itemArb, { maxLength: 12 }), (items) => {
        expect(lineasDeVenta(items)).toEqual(lineasDeVentaViejas(items));
      }),
      { numRuns: 1000 }
    );
  });
});
