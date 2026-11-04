import { describe, expect, it } from "vitest";
import { combinarTramosDeProductos, esCoincidenciaExactaDeCodigo, palabrasDeBusqueda } from "../../src/core/catalogo/public";

/**
 * Compras etapa 1, paso 5 (diseño `docs/diseno-compras-factura-unica-y-rechazo-2026-11-03.md` §5.2): la búsqueda por palabras y el orden del buscador. Todo PURO. El SQL (por palabras, sin tildes) se prueba contra la base en `buscador-de-productos-por-palabras.test.ts` y en el oráculo.
 */
describe("palabrasDeBusqueda", () => {
  it("separa por espacios, sin palabras vacías", () => {
    expect(palabrasDeBusqueda("harina 25")).toEqual(["harina", "25"]);
    expect(palabrasDeBusqueda("  harina   25 \t")).toEqual(["harina", "25"]);
    expect(palabrasDeBusqueda("   ")).toEqual([]);
  });
  it("tope de 8 palabras: el resto se ignora", () => {
    expect(palabrasDeBusqueda("a b c d e f g h i j k")).toEqual(["a", "b", "c", "d", "e", "f", "g", "h"]);
  });
  it("no toca los comodines: se escapan al armar el SQL", () => {
    expect(palabrasDeBusqueda("100%_ a\\b")).toEqual(["100%_", "a\\b"]);
  });
});

describe("esCoincidenciaExactaDeCodigo", () => {
  it("nuestro código, sin distinguir mayúsculas ni espacios de los bordes", () => {
    expect(esCoincidenciaExactaDeCodigo(" mp_ojo ", "MP_OJO", null, false)).toBe(true);
    expect(esCoincidenciaExactaDeCodigo("MP_OJ", "MP_OJO", null, false)).toBe(false);
  });
  it("palabra COMPLETA de la referencia del proveedor, solo con permiso", () => {
    expect(esCoincidenciaExactaDeCodigo("A1067", "X", "A1067 Bife angosto", true)).toBe(true);
    expect(esCoincidenciaExactaDeCodigo("A1067", "X", "A1067 Bife angosto", false)).toBe(false);
    expect(esCoincidenciaExactaDeCodigo("A106", "X", "A1067 Bife angosto", true)).toBe(false);
    expect(esCoincidenciaExactaDeCodigo("bife", "X", "A1067 Bife angosto", true)).toBe(true);
    expect(esCoincidenciaExactaDeCodigo("A1067", "X", null, true)).toBe(false);
  });
  it("término vacío no es exacto de nada", () => {
    expect(esCoincidenciaExactaDeCodigo("  ", "", "", true)).toBe(false);
  });
});

describe("combinarTramosDeProductos: orden y tope", () => {
  const p = (id: string) => ({ id, codigo: id, nombre: id });

  it("exacto, vínculo del proveedor, «empieza con», resto; sin repetir (gana el primer tramo)", () => {
    const r = combinarTramosDeProductos([[p("exacto")], [p("vinculo"), p("exacto")], [p("empieza"), p("vinculo")], [p("a-resto"), p("empieza"), p("z-resto")]], 20);
    expect(r.map((x) => x.id)).toEqual(["exacto", "vinculo", "empieza", "a-resto", "z-resto"]);
  });

  it("tope: corta en el límite, conservando el orden de los tramos", () => {
    const resto = Array.from({ length: 30 }, (_, i) => p(`r${String(i).padStart(2, "0")}`));
    const r = combinarTramosDeProductos([[p("exacto")], [p("vinculo")], [], resto], 20);
    expect(r).toHaveLength(20);
    expect(r.slice(0, 3).map((x) => x.id)).toEqual(["exacto", "vinculo", "r00"]);
  });

  it("sin tramos o tramos vacíos devuelve vacío", () => {
    expect(combinarTramosDeProductos([], 20)).toEqual([]);
    expect(combinarTramosDeProductos([[], []], 20)).toEqual([]);
  });
});
