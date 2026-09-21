import { describe, expect, it } from "vitest";
import { memoriaDesdeAlta, parsearMemoria, sanearMemoria, type MemoriaAltaProducto } from "../../src/core/catalogo/memoria-alta-producto";

/** Módulo puro: sin base de datos, sin mocks. */
describe("memoriaDesdeAlta", () => {
  it("recuerda solo los cinco campos y nada que identifique al producto ni dinero", () => {
    const m = memoriaDesdeAlta({
      tipo: "MP",
      categoriaId: "cat1",
      unidadStockId: "kg",
      unidadCompraId: "bolsa",
      factorConversion: 25,
      // Campos que un DatosProducto completo trae y que NO deben pasar a la memoria.
      ...({ nombre: "Harina 000", codigo: "MP-001", precioVenta: 999, insumoId: "ins1", observaciones: "x", esConsignacion: true, seProduce: true } as object),
    });
    expect(m).toEqual({ v: 1, tipo: "MP", categoriaId: "cat1", unidadStockId: "kg", unidadCompraId: "bolsa", factorConversion: 25 });
    expect(Object.keys(m).sort()).toEqual(["categoriaId", "factorConversion", "tipo", "unidadCompraId", "unidadStockId", "v"]);
  });

  it("los vacíos quedan en null y un factor inválido no se recuerda", () => {
    expect(memoriaDesdeAlta({ tipo: "PV", categoriaId: "", unidadStockId: "u", unidadCompraId: undefined, factorConversion: NaN })).toEqual({
      v: 1,
      tipo: "PV",
      categoriaId: null,
      unidadStockId: "u",
      unidadCompraId: null,
      factorConversion: null,
    });
    expect(memoriaDesdeAlta({ tipo: "MP", unidadStockId: "u", factorConversion: 0 }).factorConversion).toBeNull();
    expect(memoriaDesdeAlta({ tipo: "MP", unidadStockId: "u", factorConversion: -3 }).factorConversion).toBeNull();
  });
});

describe("parsearMemoria — nunca lanza y descarta todo lo que no tenga la forma exacta", () => {
  const valida: MemoriaAltaProducto = { v: 1, tipo: "MP", categoriaId: "c", unidadStockId: "s", unidadCompraId: "k", factorConversion: 2 };

  it("acepta una memoria válida (ida y vuelta por JSON, como en la base)", () => {
    expect(parsearMemoria(JSON.parse(JSON.stringify(valida)))).toEqual(valida);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["cadena vacía", ""],
    ["texto que no es JSON", "esto no es una memoria"],
    ["número", 42],
    ["arreglo", [1, 2]],
    ["objeto vacío", {}],
    ["versión desconocida", { ...valida, v: 2 }],
    ["sin versión", { tipo: "MP", categoriaId: null, unidadStockId: null, unidadCompraId: null, factorConversion: null }],
    ["tipo inválido", { ...valida, tipo: "XX" }],
    ["categoría de tipo incorrecto", { ...valida, categoriaId: 7 }],
    ["categoría vacía", { ...valida, categoriaId: "" }],
    ["id absurdamente largo", { ...valida, unidadStockId: "x".repeat(500) }],
    ["factor como texto", { ...valida, factorConversion: "25" }],
    ["factor infinito", { ...valida, factorConversion: Infinity }],
    ["factor cero", { ...valida, factorConversion: 0 }],
    ["factor negativo", { ...valida, factorConversion: -1 }],
  ])("devuelve null ante %s", (_nombre, crudo) => {
    expect(() => parsearMemoria(crudo)).not.toThrow();
    expect(parsearMemoria(crudo)).toBeNull();
  });

  it("los campos ausentes o null se leen como null", () => {
    expect(parsearMemoria({ v: 1, tipo: "PV" })).toEqual({ v: 1, tipo: "PV", categoriaId: null, unidadStockId: null, unidadCompraId: null, factorConversion: null });
  });

  it("ignora campos de más: una memoria manipulada no cuela nada", () => {
    const m = parsearMemoria({ ...valida, nombre: "Hackeado", precioVenta: 1 });
    expect(m).toEqual(valida);
    expect(m).not.toHaveProperty("nombre");
  });
});

describe("sanearMemoria — nunca propone algo que el usuario no podría elegir a mano", () => {
  const opciones = { unidades: [{ id: "kg" }, { id: "bolsa" }], categorias: [{ id: "cat1" }] };
  const completa: MemoriaAltaProducto = { v: 1, tipo: "MP", categoriaId: "cat1", unidadStockId: "kg", unidadCompraId: "bolsa", factorConversion: 25 };

  it("con todo vigente, la deja intacta", () => {
    expect(sanearMemoria(completa, opciones)).toEqual(completa);
  });

  it("una categoría borrada queda vacía y el resto SÍ se aplica", () => {
    const r = sanearMemoria({ ...completa, categoriaId: "borrada" }, opciones);
    expect(r).toEqual({ ...completa, categoriaId: null });
  });

  it("una unidad desactivada (ausente de la lista) queda vacía", () => {
    const r = sanearMemoria({ ...completa, unidadCompraId: "desactivada" }, opciones);
    expect(r?.unidadCompraId).toBeNull();
    expect(r?.unidadStockId).toBe("kg");
  });

  it("el factor sobrevive SOLO con su par de unidades: si falta cualquiera de las dos, se descarta", () => {
    expect(sanearMemoria({ ...completa, unidadCompraId: "desactivada" }, opciones)?.factorConversion).toBeNull();
    expect(sanearMemoria({ ...completa, unidadStockId: "desactivada" }, opciones)?.factorConversion).toBeNull();
    expect(sanearMemoria(completa, opciones)?.factorConversion).toBe(25);
  });

  it("un factor sin unidad de compra (par incompleto desde el origen) no se propaga", () => {
    expect(sanearMemoria({ ...completa, unidadCompraId: null }, opciones)?.factorConversion).toBeNull();
  });

  it("si no queda nada distinto del default (MP sin nada más), devuelve null: no hay aviso ni «Olvidar» sin motivo", () => {
    expect(sanearMemoria({ v: 1, tipo: "MP", categoriaId: "borrada", unidadStockId: "borrada", unidadCompraId: "borrada", factorConversion: 3 }, opciones)).toBeNull();
    expect(sanearMemoria({ v: 1, tipo: "MP", categoriaId: null, unidadStockId: null, unidadCompraId: null, factorConversion: null }, opciones)).toBeNull();
  });

  it("recordar que el último alta fue un PV ya es memoria, aunque no quede nada más", () => {
    const r = sanearMemoria({ v: 1, tipo: "PV", categoriaId: "borrada", unidadStockId: "borrada", unidadCompraId: null, factorConversion: null }, opciones);
    expect(r).toEqual({ v: 1, tipo: "PV", categoriaId: null, unidadStockId: null, unidadCompraId: null, factorConversion: null });
  });

  it("con listas vacías no propone nada (salvo el tipo PV)", () => {
    expect(sanearMemoria(completa, { unidades: [], categorias: [] })).toBeNull();
  });

  it("no muta la memoria de entrada", () => {
    const copia = structuredClone(completa);
    sanearMemoria(completa, { unidades: [], categorias: [] });
    expect(completa).toEqual(copia);
  });
});
