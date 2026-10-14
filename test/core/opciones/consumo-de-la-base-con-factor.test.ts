import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { consumoDeLaBaseConFactor } from "../../../src/core/movimientos/consumo-de-la-base-con-factor";
import { consumoDeLineaConfigurada, type IngredienteDeBase } from "../../../src/core/movimientos/consumo-de-linea-configurada";
import { pedidoDeIngrediente } from "../../../src/core/movimientos/linea-de-venta";
import { SUCURSAL } from "./escenarios";

/**
 * OPCIONES-FACTOR: la vista previa del factor de un tamaño («harina 0,25 kg → 0,325 kg») es EXACTAMENTE lo que la venta pide descontar por unidad: el «antes» es la fórmula de siempre
 * (`pedidoDeIngrediente`, sin una operación de más) y el «después» es lo que `consumoDeLineaConfigurada` devuelve para una línea con ese tamaño, bit a bit (`Object.is`). Si alguien
 * cambiara la cuenta de la vista previa (o la de la venta) sin cambiar la otra, este test lo frena.
 */

function ing(insumoProductoId: string, cantidad: number, mermaPorcentaje = 0, rendimientosLocales: IngredienteDeBase["ingrediente"]["rendimientosLocales"] = []): IngredienteDeBase {
  return { ingrediente: { insumoProductoId, cantidad, mermaPorcentaje, rendimientosLocales, insumoSustitutoIds: [] }, unidadStockId: `u-${insumoProductoId}` };
}

/** La pizza del dueño: 0,25 kg de harina y 0,10 kg de queso por unidad. */
const PIZZA = [ing("harina", 0.25), ing("queso", 0.1)];

/** Lo que la venta descuenta por unidad de una línea con un tamaño de factor `f` y sin consumos propios (lo que hace `armarLinea`). */
function laVenta(base: readonly IngredienteDeBase[], f: number, sucursalId = SUCURSAL) {
  const r = consumoDeLineaConfigurada({
    cantidad: 1,
    sucursalId,
    base,
    opciones: [{ opcionId: "grande", nombre: "Grande", tipo: "MEDIDA", ordenDeGrupo: 1, ordenDeOpcion: 3, cantidad: 1, factorEscala: f, consumos: [] }],
    adicionales: [],
  });
  if (!r.ok) throw new Error(r.mensaje);
  return r.pedidos.map((p) => p.cantidad);
}

describe("consumoDeLaBaseConFactor", () => {
  it("la pizza con 1,3: harina 0,25 → 0,325 y queso 0,1 → 0,13, en el orden de la receta", () => {
    expect(consumoDeLaBaseConFactor(PIZZA, 1.3, SUCURSAL)).toEqual([
      { insumoProductoId: "harina", antes: 0.25, despues: 0.325 },
      { insumoProductoId: "queso", antes: 0.1, despues: 0.13 },
    ]);
  });

  it("con 0,7 baja un 30% y con 1 queda igual (la fórmula de siempre, bit a bit)", () => {
    expect(consumoDeLaBaseConFactor(PIZZA, 0.7, SUCURSAL)).toEqual([
      { insumoProductoId: "harina", antes: 0.25, despues: 0.175 },
      { insumoProductoId: "queso", antes: 0.1, despues: 0.07 },
    ]);
    const igual = consumoDeLaBaseConFactor(PIZZA, 1, SUCURSAL)!;
    for (const [i, b] of PIZZA.entries()) {
      expect(Object.is(igual[i]!.antes, pedidoDeIngrediente(1, b.ingrediente, b.unidadStockId, SUCURSAL).cantidad)).toBe(true);
      expect(Object.is(igual[i]!.despues, igual[i]!.antes)).toBe(true);
    }
  });

  it("incluye la merma y la calibración de ESTA sucursal, como la venta (y no la de otra)", () => {
    const base = [ing("harina", 0.25, 10, [{ sucursalId: SUCURSAL, cantidad: 0.3, mermaPorcentaje: null }, { sucursalId: "otra", cantidad: 9, mermaPorcentaje: 50 }])];
    // 0,3 (la de esta sucursal) × 1,1 (merma central del 10%) = 0,33; × 2 = 0,66.
    expect(consumoDeLaBaseConFactor(base, 2, SUCURSAL)).toEqual([{ insumoProductoId: "harina", antes: 0.33, despues: 0.66 }]);
  });

  it("sin receta, ninguna línea; con un factor que la venta rechaza, `null` (la pantalla muestra solo el aviso)", () => {
    expect(consumoDeLaBaseConFactor([], 1.3, SUCURSAL)).toEqual([]);
    expect(consumoDeLaBaseConFactor(PIZZA, 0, SUCURSAL)).toBeNull();
    expect(consumoDeLaBaseConFactor(PIZZA, 10.5, SUCURSAL)).toBeNull();
    expect(consumoDeLaBaseConFactor(PIZZA, Number.NaN, SUCURSAL)).toBeNull();
  });

  it("propiedad: para cualquier receta y cualquier factor válido, «antes» es la venta sin tamaño y «después» la venta con ese tamaño, bit a bit", () => {
    const linea = fc.record({
      cantidad: fc.integer({ min: 1, max: 100_000 }).map((n) => n / 10_000),
      merma: fc.integer({ min: 0, max: 10_000 }).map((n) => n / 100),
      local: fc.option(fc.integer({ min: 1, max: 100_000 }).map((n) => n / 10_000), { nil: null }),
    });
    fc.assert(
      fc.property(fc.array(linea, { maxLength: 6 }), fc.integer({ min: 1, max: 100_000 }), (lineas, n) => {
        const f = Number((n / 10_000).toFixed(4));
        const base = lineas.map((l, i) => ing(`mp-${i}`, l.cantidad, l.merma, l.local === null ? [] : [{ sucursalId: SUCURSAL, cantidad: l.local, mermaPorcentaje: null }]));
        const vista = consumoDeLaBaseConFactor(base, f, SUCURSAL);
        expect(vista).not.toBeNull();
        const sinTamano = base.map((b) => pedidoDeIngrediente(1, b.ingrediente, b.unidadStockId, SUCURSAL).cantidad);
        const conTamano = laVenta(base, f);
        expect(vista!.map((l) => l.insumoProductoId)).toEqual(base.map((b) => b.ingrediente.insumoProductoId));
        vista!.forEach((l, i) => {
          expect(Object.is(l.antes, sinTamano[i]), `antes de ${l.insumoProductoId}`).toBe(true);
          expect(Object.is(l.despues, conTamano[i]), `después de ${l.insumoProductoId}`).toBe(true);
        });
      }),
    );
  });
});
