import { describe, expect, it } from "vitest";
import { SIN_FILTROS, consultaDeLosFiltros, hayFiltrosDeProductos, leerFiltrosDeProductos } from "../../src/core/catalogo/public";

/** Fase 6, bloque 3, 3b: los filtros de la lista de Productos, puros (palabras de listas cerradas en la URL). */
describe("leerFiltrosDeProductos", () => {
  it("sin nada puesto no hay filtros", () => {
    expect(leerFiltrosDeProductos({})).toEqual(SIN_FILTROS);
    expect(hayFiltrosDeProductos(SIN_FILTROS)).toBe(false);
  });

  it("lee cada filtro de su lista cerrada", () => {
    const f = leerFiltrosDeProductos({ q: "  pizza ", tipo: "venta", modo: "por-opcion", disponible: "en-ninguna", falta: "sin-receta" });
    expect(f).toEqual({ q: "pizza", tipo: "venta", modo: "por-opcion", disponible: "en-ninguna", falta: "sin-receta" });
    expect(hayFiltrosDeProductos(f)).toBe(true);
  });

  it("ignora lo que no es de la lista, o no es un texto, sin romper", () => {
    expect(leerFiltrosDeProductos({ tipo: "Venta", modo: ["directo"], disponible: 1, falta: {}, q: 5 })).toEqual(SIN_FILTROS);
    expect(leerFiltrosDeProductos({ tipo: "constructor", falta: "toString" })).toEqual(SIN_FILTROS);
  });

  it("acota la búsqueda al largo de un nombre de catálogo y le saca el NUL", () => {
    expect(leerFiltrosDeProductos({ q: "x".repeat(500) }).q).toHaveLength(80);
    expect(leerFiltrosDeProductos({ q: "ha\u0000rina" }).q).not.toContain("\u0000");
  });
});

describe("consultaDeLosFiltros", () => {
  it("escribe solo lo puesto, en orden fijo y codificado, y suma el cursor al final", () => {
    expect(consultaDeLosFiltros(SIN_FILTROS)).toBe("");
    expect(consultaDeLosFiltros(leerFiltrosDeProductos({ q: "pan & té", falta: "sin-precio", tipo: "venta" }), "abc")).toBe("q=pan%20%26%20t%C3%A9&tipo=venta&falta=sin-precio&cursor=abc");
  });

  it("lo que escribe se vuelve a leer igual", () => {
    const f = leerFiltrosDeProductos({ q: "café", tipo: "materia-prima", modo: "directo", disponible: "no-aca", falta: "fuera-de-la-carta" });
    const params = Object.fromEntries(new URLSearchParams(consultaDeLosFiltros(f)));
    expect(leerFiltrosDeProductos(params)).toEqual(f);
  });
});
