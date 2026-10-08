import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { rendimientoEfectivo } from "../../src/core/catalogo/rendimiento-local";
import { pedidoDeIngrediente } from "../../src/core/movimientos/linea-de-venta";
import type { IngredienteParaVender } from "../../src/core/movimientos/public";

/**
 * Propiedades (fast-check) de `pedidoDeIngrediente` (Hito 5, 5.1-4): lo que consume la venta de un ingrediente es EXACTAMENTE el `number` de siempre, no uno parecido. La fórmula
 * vieja (`cantidad * ef.cantidad * (1 + ef.mermaPorcentaje / 100)`, de `armarLinea` antes de la mudanza) está copiada ACÁ, textual: una reasociación (`cantidad * (ef.cantidad * (...))`)
 * da el mismo resultado en el papel y otro en los últimos bits del `number`, y esos bits llegan al Kardex (`MovimientoStock.cantidad`, `cantidadExacta`) y al arrastre de redondeo. Se compara
 * con `Object.is`, no con una tolerancia.
 */

const numeroArb = fc.double({ min: 0.001, max: 1000, noNaN: true, noDefaultInfinity: true });
const mermaArb = fc.double({ min: 0, max: 99, noNaN: true, noDefaultInfinity: true });
const SUCURSALES = ["suc-a", "suc-b", "suc-c"] as const;

const calibracionArb = fc.record({
  sucursalId: fc.constantFrom(...SUCURSALES),
  cantidad: fc.option(numeroArb, { nil: null }),
  mermaPorcentaje: fc.option(mermaArb, { nil: null }),
});

const ingredienteArb: fc.Arbitrary<IngredienteParaVender> = fc.record({
  insumoProductoId: fc.constantFrom("mp-1", "mp-2", "mp-3"),
  cantidad: numeroArb,
  mermaPorcentaje: mermaArb,
  rendimientosLocales: fc.array(calibracionArb, { maxLength: 4 }),
  insumoSustitutoIds: fc.array(fc.constantFrom("ins-1", "ins-2", "ins-3"), { maxLength: 3 }),
});

describe("pedidoDeIngrediente: el consumo de un ingrediente es la fórmula de siempre, bit a bit", () => {
  it("con cualquier calibración, el resultado es Object.is-igual a la fórmula vieja", () => {
    fc.assert(
      fc.property(numeroArb, ingredienteArb, fc.constantFrom(...SUCURSALES), (cantidad, ing, sucursalId) => {
        const ef = rendimientoEfectivo({ cantidad: ing.cantidad, mermaPorcentaje: ing.mermaPorcentaje }, ing.rendimientosLocales, sucursalId);
        const viejo = cantidad * ef.cantidad * (1 + ef.mermaPorcentaje / 100);
        expect(Object.is(pedidoDeIngrediente(cantidad, ing, "u-1", sucursalId).cantidad, viejo)).toBe(true);
      }),
      { numRuns: 1000 }
    );
  });

  it("sin ninguna calibración de ESTA sucursal, usa los valores centrales tal cual (sin pasar por ninguna cuenta de más)", () => {
    fc.assert(
      fc.property(numeroArb, ingredienteArb, (cantidad, ing) => {
        const sinCalibrar = { ...ing, rendimientosLocales: ing.rendimientosLocales.filter((r) => r.sucursalId !== "suc-a") };
        const esperado = cantidad * ing.cantidad * (1 + ing.mermaPorcentaje / 100);
        expect(Object.is(pedidoDeIngrediente(cantidad, sinCalibrar, "u-1", "suc-a").cantidad, esperado)).toBe(true);
      }),
      { numRuns: 1000 }
    );
  });

  it("el producto, los sustitutos y la unidad de stock pasan tal cual", () => {
    fc.assert(
      fc.property(numeroArb, ingredienteArb, (cantidad, ing) => {
        const pedido = pedidoDeIngrediente(cantidad, ing, "u-9", "suc-a");
        expect(pedido.productoId).toBe(ing.insumoProductoId);
        expect(pedido.insumoSustitutoIds).toBe(ing.insumoSustitutoIds);
        expect(pedido.unidadStockId).toBe("u-9");
      })
    );
  });
});
