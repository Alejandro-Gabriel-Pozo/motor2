import { describe, expect, it } from "vitest";
import { factorDeBruto, factorDeBrutoExacto, factorDeMerma, factorDeMermaExacto } from "../../src/core/catalogo/public";
import { consumoDeLineaConfigurada, type ConsumoDeOpcionParaVender, type IngredienteDeBase, type OpcionConConsumo } from "../../src/core/movimientos/consumo-de-linea-configurada";
import { pedidoDeIngrediente, type IngredienteParaVender } from "../../src/core/movimientos/linea-de-venta";

/**
 * M3a, parte 2 (2026-11-17; `docs/diseno-merma-sobre-bruto-como-pedernal-2026-11-15.md` §7.2): lo que SALE DEL STOCK (el bruto) según la base de la versión.
 * NETA (todo lo ya cargado): la cantidad más su merma, el factor de siempre (BIT A BIT, `Object.is`: ningún resultado de hoy se mueve). BRUTA: la cantidad tal cual (factor 1).
 * Una marca que no es NETA ni BRUTA CIERRA: nunca se asume una base ni se omite la merma.
 */
const MERMAS = [0, 0.01, 0.5, 2.5, 10, 12.5, 25, 33.33, 50, 99.99, 100];

describe("factorDeBruto y factorDeBrutoExacto", () => {
  it("NETA da EXACTAMENTE el factor de siempre (Object.is, en toda la grilla de mermas): ninguna cuenta de hoy cambia ni un bit", () => {
    for (const m of MERMAS) {
      expect(Object.is(factorDeBruto("NETA", m), factorDeMerma(m)), `merma ${m}`).toBe(true);
      expect(factorDeBrutoExacto("NETA", m).toString(), `merma ${m}`).toBe(factorDeMermaExacto(m).toString());
    }
  });

  it("BRUTA da 1 para cualquier merma (la cantidad ya es lo que sale del stock; la merma que traiga la línea no se multiplica)", () => {
    for (const m of MERMAS) {
      expect(factorDeBruto("BRUTA", m), `merma ${m}`).toBe(1);
      expect(factorDeBrutoExacto("BRUTA", m).toString(), `merma ${m}`).toBe("1");
    }
  });

  it.each([undefined, null, "", "neta", "MIXTA", 0])("una marca ilegible (%j) CIERRA: lanza error, no asume una base", (mala) => {
    expect(() => factorDeBruto(mala as never, 10)).toThrow(/no es legible/);
    expect(() => factorDeBrutoExacto(mala as never, 10)).toThrow(/no es legible/);
  });
});

describe("pedidoDeIngrediente (la venta de un PV con receta) lee la marca", () => {
  const ing = (baseDeCantidad: "NETA" | "BRUTA", extra: Partial<IngredienteParaVender> = {}): IngredienteParaVender => ({ insumoProductoId: "mp-1", cantidad: 0.5, mermaPorcentaje: 10, baseDeCantidad, rendimientosLocales: [], insumoSustitutoIds: [], ...extra });

  it("NETA: 2 × 0,5 × 1,10 (con la merma, como siempre); BRUTA: 2 × 0,5 (la cantidad tal cual)", () => {
    expect(pedidoDeIngrediente(2, ing("NETA"), "u-1", "suc-a").cantidad).toBe(2 * 0.5 * (1 + 10 / 100));
    expect(pedidoDeIngrediente(2, ing("BRUTA"), "u-1", "suc-a").cantidad).toBe(1);
  });

  it("la calibración de ESTA sucursal respeta la base: BRUTA usa su cantidad calibrada sin multiplicar por la merma calibrada", () => {
    const calibrado = ing("BRUTA", { rendimientosLocales: [{ sucursalId: "suc-a", cantidad: 0.4, mermaPorcentaje: 50 }] });
    expect(pedidoDeIngrediente(1, calibrado, "u-1", "suc-a").cantidad).toBe(0.4);
    expect(pedidoDeIngrediente(1, calibrado, "u-1", "suc-b").cantidad).toBe(0.5); // otra sucursal: la central
  });
});

describe("consumoDeLineaConfigurada (la venta con opciones) lee la marca de la versión de cada opción", () => {
  const suma = (insumoProductoId: string, cantidad: number, mermaPorcentaje: number, baseDeCantidad: "NETA" | "BRUTA"): ConsumoDeOpcionParaVender => ({
    efecto: "SUMA", insumoProductoId, reemplazaAProductoId: null, cantidad, unidadStockId: "u-g", mermaPorcentaje, baseDeCantidad, escalaConLaMedida: false,
  });
  const guarnicion = (consumos: ConsumoDeOpcionParaVender[]): OpcionConConsumo => ({ opcionId: "o-papas", nombre: "Papas", tipo: "INCLUIDA", ordenDeGrupo: 0, ordenDeOpcion: 0, cantidad: 2, factorEscala: null, consumos });
  const pedidosDe = (opcion: OpcionConConsumo, base: IngredienteDeBase[] = [], cantidad = 3) => {
    const r = consumoDeLineaConfigurada({ cantidad, sucursalId: "suc-a", base, opciones: [opcion], adicionales: [] });
    if (!r.ok) throw new Error(r.mensaje);
    return r.pedidos.map((p) => [p.productoId, p.cantidad]);
  };

  it("el consumo de una opción NETA suma su merma (150 × 2 × 3 × 1,10 = 990) y el de una BRUTA, no (150 × 2 × 3 = 900)", () => {
    expect(pedidosDe(guarnicion([suma("mp-papas", 150, 10, "NETA")]))).toEqual([["mp-papas", 990]]);
    expect(pedidosDe(guarnicion([suma("mp-papas", 150, 10, "BRUTA")]))).toEqual([["mp-papas", 900]]);
  });

  it("la base del PV y la de la opción son independientes: la receta NETA de la base conserva su merma aunque la opción sea BRUTA (y al revés)", () => {
    const base = (baseDeCantidad: "NETA" | "BRUTA"): IngredienteDeBase[] => [{ unidadStockId: "u-g", ingrediente: { insumoProductoId: "mp-base", cantidad: 10, mermaPorcentaje: 20, baseDeCantidad, rendimientosLocales: [], insumoSustitutoIds: [] } }];
    const opcion = guarnicion([suma("mp-papas", 100, 0, "BRUTA")]);
    const mediana: OpcionConConsumo = { opcionId: "o-med", nombre: "Mediana", tipo: "MEDIDA", ordenDeGrupo: 1, ordenDeOpcion: 0, cantidad: 1, factorEscala: 2, consumos: [] };
    // Con una MEDIDA de factor 2 la base se escala por 2 (cuenta exacta): receta NETA 3 × 2 × 10 × 1,20 = 72; receta BRUTA 3 × 2 × 10 = 60.
    const conMedida = (b: IngredienteDeBase[]) => {
      const r = consumoDeLineaConfigurada({ cantidad: 3, sucursalId: "suc-a", base: b, opciones: [mediana, opcion], adicionales: [] });
      if (!r.ok) throw new Error(r.mensaje);
      return Object.fromEntries(r.pedidos.map((p) => [p.productoId, p.cantidad]));
    };
    expect(conMedida(base("NETA"))).toEqual({ "mp-base": 72, "mp-papas": 600 });
    expect(conMedida(base("BRUTA"))).toEqual({ "mp-base": 60, "mp-papas": 600 });
    expect(pedidosDe(guarnicion([suma("mp-papas", 100, 20, "NETA")]), base("BRUTA"))).toEqual([["mp-base", 30], ["mp-papas", 720]]); // base BRUTA 3 × 10; opción NETA 100 × 2 × 3 × 1,20
  });
});
