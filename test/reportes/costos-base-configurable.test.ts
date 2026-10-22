import { describe, expect, it } from "vitest";
import { calcularCostosYMargenesDesde, calcularImpactoRecetasPorPeriodoDesde } from "../../src/core/reportes/costos";
import { armarMapaProductos, type CostoMP, type FilaDeProductoParaReporte, type IngredienteRecetaReporte, type InfoProductoReporte } from "../../src/core/reportes/comun";

/**
 * Fase 4 de la ola «precio y carta», C7b (ADR-035; decisión del dueño): en el reporte de costos, un producto que se vende por opción aparece «Por opción» (`POR_OPCION`), SIN margen, sin food cost y sin
 * precio para el objetivo: su precio guardado no se cobra. El costo de su receta común se sigue mostrando. Un producto directo no cambia. El mapa de productos de los reportes marca la base (`esBase`)
 * solo cuando lo es (un directo queda con la forma de siempre).
 */
describe("costos y márgenes de una base configurable", () => {
  const insumo: InfoProductoReporte = {
    id: "mp-1", codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", disponible: true, seProduce: false, precioVenta: 0, categoriaNombre: null, categoriaId: null,
    insumoNombre: null, grupoNombre: null, esNoComestible: false, unidadStockNombre: "kg", esConsignacion: false, proveedorConsignacionNombre: null,
  };
  const pizzas: InfoProductoReporte = { ...insumo, id: "pv-1", codigo: "PV_PIZZAS", nombre: "Pizzas", tipo: "PV", precioVenta: 18000, esBase: true };
  const gaseosa: InfoProductoReporte = { ...insumo, id: "pv-2", codigo: "PV_GASEOSA", nombre: "Gaseosa", tipo: "PV", precioVenta: 4000 };
  const ing = (productoId: string): IngredienteRecetaReporte => ({ recetaIngredienteId: `ri-${productoId}`, insumoProductoId: insumo.id, insumoNombre: insumo.nombre, cantidad: 2, unidadNombre: "kg", mermaPorcentaje: 0, cantidadCentral: 2, mermaPorcentajeCentral: 0, calibradoLocal: false });
  const costo = (precio: number): CostoMP => ({ precioPorUnidadStock: precio, proveedorNombre: "Molino", fecha: new Date("2026-01-01") });
  const productos = new Map([[insumo.id, insumo], [pizzas.id, pizzas], [gaseosa.id, gaseosa]]);
  const recetas = new Map([[pizzas.id, [ing(pizzas.id)]], [gaseosa.id, [ing(gaseosa.id)]]]);

  it("la base: «Por opción», con su costo y sin margen, food cost ni precio para el objetivo; el directo, como siempre", () => {
    const filas = calcularCostosYMargenesDesde(productos, recetas, new Map([[insumo.id, costo(1000)]]));
    expect(filas.find((f) => f.productoId === pizzas.id)).toMatchObject({ estado: "POR_OPCION", costo: 2000, margen: null, margenPct: null, foodCostPct: null, precioSugerido: null });
    const directo = filas.find((f) => f.productoId === gaseosa.id)!;
    expect(directo).toMatchObject({ costo: 2000, margen: 2000, margenPct: 50, foodCostPct: 50 });
    expect(directo.estado).not.toBe("POR_OPCION");
    expect(directo.precioSugerido).not.toBeNull();
    // Aunque el costo supere el precio guardado, una base no es «Margen negativo».
    expect(calcularCostosYMargenesDesde(productos, recetas, new Map([[insumo.id, costo(10000)]])).find((f) => f.productoId === pizzas.id)!.estado).toBe("POR_OPCION");
  });

  it("el impacto de las recetas en el período: sin food cost contra el precio guardado de una base", () => {
    const filas = calcularImpactoRecetasPorPeriodoDesde(productos, recetas, new Map([[insumo.id, costo(1200)]]), new Map([[insumo.id, costo(1000)]]), false);
    expect(filas.find((f) => f.productoId === pizzas.id)).toMatchObject({ deltaCosto: 400, foodCostPctAntes: null, foodCostPctActual: null });
    expect(filas.find((f) => f.productoId === gaseosa.id)).toMatchObject({ foodCostPctAntes: 50, foodCostPctActual: 60 });
  });

  it("el mapa de productos de los reportes marca solo la base", () => {
    const fila = (id: string, modoDeVenta?: string): FilaDeProductoParaReporte => ({
      id, codigo: id, nombre: id, tipo: "PV", seProduce: false, precioVenta: 100, categoriaId: null, categoria: null, insumo: null, unidadStock: { nombre: "u" }, esConsignacion: false, proveedorConsignacion: null,
      ...(modoDeVenta === undefined ? {} : { modoDeVenta }),
    });
    const mapa = armarMapaProductos([fila("a", "BASE_CONFIGURABLE"), fila("b", "DIRECTO"), fila("c")], new Map(), { idsGrupos: new Set() } as never, new Map());
    expect(mapa.get("a")!.esBase).toBe(true);
    expect("esBase" in mapa.get("b")!).toBe(false);
    expect("esBase" in mapa.get("c")!).toBe(false);
  });
});
