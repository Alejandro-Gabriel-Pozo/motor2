import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { armarFilasStockParaConteo, elegirLoteMasProximoAVencer, repartirConsumoPorFamilia, type ProductoParaConteo } from "../../src/core/movimientos/reparto-de-stock";

/**
 * El cálculo PURO de los lectores del Kardex (Pureza Fase 4, tramo A): FEFO, reparto del consumo entre los hermanos de un insumo y la grilla de Conteo Físico. Sin base:
 * las filas ya leídas entran por parámetro. Complementa a los tests con Postgres real (`test/auditoria/precision-roundtrip-y-reparto.test.ts`, `test/stock/stock-para-conteo.test.ts`),
 * que siguen verificando que el lector y el cálculo juntos dan lo de siempre.
 */
const dia = (n: number) => new Date(`2026-0${n}-15T00:00:00.000Z`);

describe("elegirLoteMasProximoAVencer", () => {
  it("elige el lote con saldo positivo que vence antes", () => {
    expect(elegirLoteMasProximoAVencer([{ loteVencimiento: dia(5), saldo: 3 }, { loteVencimiento: dia(2), saldo: 1 }, { loteVencimiento: dia(3), saldo: 9 }])).toEqual(dia(2));
  });

  it("ignora los lotes sin saldo, con saldo negativo y el bucket «sin lote»", () => {
    expect(elegirLoteMasProximoAVencer([{ loteVencimiento: dia(1), saldo: 0 }, { loteVencimiento: dia(2), saldo: -4 }, { loteVencimiento: null, saldo: 7 }, { loteVencimiento: dia(6), saldo: 2 }])).toEqual(dia(6));
  });

  it("sin ningún lote con fecha y saldo → null", () => {
    expect(elegirLoteMasProximoAVencer([])).toBeNull();
    expect(elegirLoteMasProximoAVencer([{ loteVencimiento: null, saldo: 5 }, { loteVencimiento: dia(1), saldo: 0 }])).toBeNull();
  });

  it("no modifica la entrada", () => {
    const entrada = [{ loteVencimiento: dia(5), saldo: 3 }, { loteVencimiento: dia(2), saldo: 1 }];
    elegirLoteMasProximoAVencer(entrada);
    expect(entrada.map((e) => e.loteVencimiento)).toEqual([dia(5), dia(2)]);
  });
});

describe("repartirConsumoPorFamilia", () => {
  const hermano = (productoId: string, saldo: number, loteVencimiento: Date | null = null) => ({ productoId, loteVencimiento, saldo });

  it("reparte con FEFO: el lote que vence antes primero, los lotes sin fecha al final", () => {
    const partes = repartirConsumoPorFamilia([hermano("B", 4, null), hermano("A", 3, dia(5)), hermano("C", 2, dia(2))], 6);
    expect(partes).toEqual([
      { productoId: "C", loteVencimiento: dia(2), cantidad: 2 },
      { productoId: "A", loteVencimiento: dia(5), cantidad: 3 },
      { productoId: "B", loteVencimiento: null, cantidad: 1 },
    ]);
  });

  it("un solo hermano que alcanza se lleva todo", () => {
    expect(repartirConsumoPorFamilia([hermano("A", 10)], 4)).toEqual([{ productoId: "A", loteVencimiento: null, cantidad: 4 }]);
  });

  it("si el insumo ENTERO tampoco alcanza → null (el llamador cae al camino de siempre)", () => {
    expect(repartirConsumoPorFamilia([hermano("A", 1), hermano("B", 1)], 3)).toBeNull();
    expect(repartirConsumoPorFamilia([], 1)).toBeNull();
  });

  it("los saldos en cero o negativos no cuentan para alcanzar ni reciben consumo", () => {
    expect(repartirConsumoPorFamilia([hermano("A", 0), hermano("B", -2), hermano("C", 5)], 5)).toEqual([{ productoId: "C", loteVencimiento: null, cantidad: 5 }]);
    expect(repartirConsumoPorFamilia([hermano("A", 0), hermano("B", -2)], 1)).toBeNull();
  });

  it("el redondeo a 4 decimales evita que el ruido del punto flotante rechace un pedido que calza justo (el flake de «3 hermanos»)", () => {
    // 3.37 + 2.19 + 1.81 = 7.37 en decimal exacto; en coma flotante, según el orden de la suma, puede dar 7.370000000000001.
    for (const orden of [[3.37, 2.19, 1.81], [1.81, 2.19, 3.37], [2.19, 3.37, 1.81]]) {
      const partes = repartirConsumoPorFamilia(orden.map((s, i) => hermano(`P${i}`, s)), 7.37);
      expect(partes, `orden ${orden.join(", ")}`).not.toBeNull();
    }
  });

  it("0,7 + 0,1 en coma flotante da 0,7999… y NO debe hacer que un pedido de 0,8 «no alcance»: se compara redondeado a 4 decimales", () => {
    expect(0.7 + 0.1).toBeLessThan(0.8); // la trampa de la coma flotante, a la vista
    const partes = repartirConsumoPorFamilia([hermano("A", 0.7), hermano("B", 0.1)], 0.8);
    expect(partes).not.toBeNull();
    expect(partes!.map((p) => p.productoId)).toEqual(["A", "B"]);
  });

  it("pedir cero no reparte nada pero tampoco es «no alcanza»", () => {
    expect(repartirConsumoPorFamilia([hermano("A", 3)], 0)).toEqual([]);
  });

  it("propiedad: si alcanza, las partes suman EXACTAMENTE lo pedido, ninguna supera el saldo de su lote y se usan los lotes en orden FEFO", () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ saldo: fc.integer({ min: 1, max: 500 }), mes: fc.option(fc.integer({ min: 1, max: 9 }), { nil: null }) }), { minLength: 1, maxLength: 6 }),
        fc.integer({ min: 1, max: 1500 }),
        (lotes, pedidoEnCentesimas) => {
          const candidatos = lotes.map((l, i) => hermano(`P${i}`, l.saldo / 100, l.mes === null ? null : dia(l.mes)));
          const pedido = pedidoEnCentesimas / 100;
          const total = lotes.reduce((a, l) => a + l.saldo, 0) / 100;
          const partes = repartirConsumoPorFamilia(candidatos, pedido);
          if (total + 1e-9 < pedido) return partes === null;
          if (partes === null) return false;
          const suma = partes.reduce((a, p) => a + p.cantidad, 0);
          const sinExcederSaldo = partes.every((p) => p.cantidad <= candidatos.find((c) => c.productoId === p.productoId)!.saldo + 1e-12);
          const fechas = partes.map((p) => p.loteVencimiento?.getTime() ?? Infinity);
          const enOrden = fechas.every((f, i) => i === 0 || fechas[i - 1] <= f);
          return Math.abs(suma - pedido) < 1e-9 && sinExcederSaldo && enOrden;
        }
      )
    );
  });
});

describe("armarFilasStockParaConteo", () => {
  const producto = (id: string, nombre: string, extra: Partial<ProductoParaConteo> = {}): ProductoParaConteo => ({
    id,
    codigo: `C_${id}`,
    nombre,
    tipo: "MP",
    seProduce: false,
    unidadStock: { nombre: "kg", decimales: 2 },
    ...extra,
  });
  const mapa = (...ps: ProductoParaConteo[]) => new Map(ps.map((p) => [p.id, p]));
  const todoDisponible = (...ids: string[]) => new Map(ids.map((i) => [i, true]));

  it("una fila por (producto, lote), con el saldo redondeado a los decimales de la unidad, ordenadas por nombre en castellano y por lote (sin lote primero)", () => {
    const filas = armarFilasStockParaConteo(
      [
        { productoId: "z", loteVencimiento: dia(5), saldo: 1.234 },
        { productoId: "a", loteVencimiento: dia(3), saldo: 2 },
        { productoId: "a", loteVencimiento: null, saldo: 3 },
        { productoId: "e", loteVencimiento: null, saldo: 0.5 },
      ],
      mapa(producto("z", "Zanahoria"), producto("a", "Ají"), producto("e", "Écuador")),
      todoDisponible("z", "a", "e")
    );
    expect(filas.map((f) => [f.productoNombre, f.loteVencimiento?.toISOString().slice(0, 10) ?? null, f.saldoSistema])).toEqual([
      ["Ají", null, 3],
      ["Ají", "2026-03-15", 2],
      ["Écuador", null, 0.5],
      ["Zanahoria", "2026-05-15", 1.23],
    ]);
    expect(filas[0]).toMatchObject({ productoId: "a", productoCodigo: "C_a", unidadStockNombre: "kg" });
  });

  it("deja afuera lo no disponible en la sucursal, lo que no existe y los PV comunes (sin stock real); un PV que se produce sí entra", () => {
    const filas = armarFilasStockParaConteo(
      [
        { productoId: "mp", loteVencimiento: null, saldo: 1 },
        { productoId: "noDisp", loteVencimiento: null, saldo: 1 },
        { productoId: "fantasma", loteVencimiento: null, saldo: 1 },
        { productoId: "pvComun", loteVencimiento: null, saldo: 1 },
        { productoId: "pvProduce", loteVencimiento: null, saldo: 1 },
      ],
      mapa(producto("mp", "MP"), producto("noDisp", "No disponible"), producto("pvComun", "PV común", { tipo: "PV" }), producto("pvProduce", "PV que se produce", { tipo: "PV", seProduce: true })),
      new Map([["mp", true], ["noDisp", false], ["pvComun", true], ["pvProduce", true]])
    );
    expect(filas.map((f) => f.productoNombre)).toEqual(["MP", "PV que se produce"]);
  });

  it("sin grupos → sin filas", () => {
    expect(armarFilasStockParaConteo([], new Map(), new Map())).toEqual([]);
  });
});
