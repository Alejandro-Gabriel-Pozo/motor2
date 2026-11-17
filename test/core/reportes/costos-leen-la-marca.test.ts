import { describe, expect, it } from "vitest";
import { calcularCostosYMargenesDesde, costoUnitarioDeInsumoDesde, resolverCostoRecetaCompleta } from "../../../src/core/reportes/costos";
import { armarIndiceRecetas, type CostoMP, type IngredienteRecetaReporte, type InfoProductoReporte } from "../../../src/core/reportes/comun";

/**
 * M3a, parte 2 (2026-11-17; `docs/diseno-merma-sobre-bruto-como-pedernal-2026-11-15.md` §7.2): las TRES cuentas de costo de `core/reportes/costos.ts` leen la base de la versión de la receta:
 * NETA (todo lo ya cargado) costea `cantidad × (1 + merma/100)`; BRUTA costea la cantidad tal cual (ya es lo que sale del stock). Cada una se prueba aparte, con una subreceta
 * (la recursión de `resolverCostoUnitario`), para que revertir cualquiera de las tres ponga algo en rojo. Y el índice de recetas CIERRA ante una marca ilegible.
 */
const info = (id: string, nombre: string, extra: Partial<InfoProductoReporte> = {}): InfoProductoReporte => ({
  id, codigo: id.toUpperCase(), nombre, tipo: "MP", disponible: true, seProduce: false, precioVenta: 0, categoriaNombre: null, categoriaId: null, insumoNombre: null, grupoNombre: null,
  esNoComestible: false, unidadStockNombre: "kg", esConsignacion: false, proveedorConsignacionNombre: null, ...extra,
});
const linea = (insumoProductoId: string, cantidad: number, mermaPorcentaje: number, baseDeCantidad: "NETA" | "BRUTA"): IngredienteRecetaReporte => ({
  recetaIngredienteId: `ri-${insumoProductoId}-${baseDeCantidad}`, insumoProductoId, insumoNombre: insumoProductoId, cantidad, unidadNombre: "kg", mermaPorcentaje, baseDeCantidad,
  cantidadCentral: cantidad, mermaPorcentajeCentral: mermaPorcentaje, calibradoLocal: false,
});
const costo = (precio: number): CostoMP => ({ precioPorUnidadStock: precio, proveedorNombre: "Proveedor", fecha: new Date("2026-01-01") });

/** Tomate ($10/kg) → salsa (se produce: 0,5 kg de tomate con 20 % de merma) → plato (0,3 kg de salsa). `baseDeLaSalsa` y `baseDelPlato` eligen la base de cada receta. */
function escenario(baseDeLaSalsa: "NETA" | "BRUTA", baseDelPlato: "NETA" | "BRUTA") {
  const productos = new Map<string, InfoProductoReporte>([
    ["tomate", info("tomate", "Tomate")],
    ["salsa", info("salsa", "Salsa", { seProduce: true })],
    ["plato", info("plato", "Plato", { tipo: "PV", precioVenta: 100 })],
  ]);
  const recetaPorProducto = new Map<string, IngredienteRecetaReporte[]>([
    ["salsa", [linea("tomate", 0.5, 20, baseDeLaSalsa)]],
    ["plato", [linea("salsa", 0.3, 10, baseDelPlato)]],
  ]);
  const costosCompra = new Map<string, CostoMP>([["tomate", costo(10)]]);
  return { productos, recetaPorProducto, costosCompra };
}

describe("resolverCostoUnitario (la recursión sobre una subreceta) lee la marca", () => {
  it("la salsa NETA cuesta 10 × 0,5 × 1,2 = 6 por kg; la BRUTA, 10 × 0,5 = 5 (sin la merma)", () => {
    const n = escenario("NETA", "NETA");
    const b = escenario("BRUTA", "NETA");
    expect(costoUnitarioDeInsumoDesde(n.productos, n.recetaPorProducto, n.costosCompra)("salsa")).toBeCloseTo(6, 10);
    expect(costoUnitarioDeInsumoDesde(b.productos, b.recetaPorProducto, b.costosCompra)("salsa")).toBe(5);
  });
});

describe("calcularCostosYMargenesDesde lee la marca del plato", () => {
  const costoDelPlato = (e: ReturnType<typeof escenario>) =>
    calcularCostosYMargenesDesde(e.productos, e.recetaPorProducto, e.costosCompra).find((f) => f.productoNombre === "Plato")?.costo;

  it("plato NETA con salsa NETA: 0,3 × 1,1 × 6 = 1,98; plato BRUTA con salsa BRUTA: 0,3 × 5 = 1,5", () => {
    expect(costoDelPlato(escenario("NETA", "NETA"))).toBeCloseTo(1.98, 10);
    expect(costoDelPlato(escenario("BRUTA", "BRUTA"))).toBe(1.5);
  });

  it("la base del plato y la de la salsa son independientes: plato BRUTA sobre salsa NETA = 0,3 × 6 = 1,8; plato NETA sobre salsa BRUTA = 0,3 × 1,1 × 5 = 1,65", () => {
    expect(costoDelPlato(escenario("NETA", "BRUTA"))).toBeCloseTo(1.8, 10);
    expect(costoDelPlato(escenario("BRUTA", "NETA"))).toBeCloseTo(1.65, 10);
  });
});

describe("resolverCostoRecetaCompleta lee la marca", () => {
  it("costo completo del plato: NETA/NETA 1,98; BRUTA/BRUTA 1,5", () => {
    const n = escenario("NETA", "NETA");
    const b = escenario("BRUTA", "BRUTA");
    expect(resolverCostoRecetaCompleta("plato", n.productos, n.recetaPorProducto, n.costosCompra)).toBeCloseTo(1.98, 10);
    expect(resolverCostoRecetaCompleta("plato", b.productos, b.recetaPorProducto, b.costosCompra)).toBe(1.5);
  });
});

describe("armarIndiceRecetas: la marca de la versión viaja a cada línea y una marca ilegible CIERRA", () => {
  const receta = (baseDeCantidad: unknown) => ({
    productoId: "plato", baseDeCantidad,
    ingredientes: [{ id: "ri-1", insumoProductoId: "salsa", insumoProducto: { nombre: "Salsa" }, unidad: { nombre: "kg" }, cantidad: 0.3, mermaPorcentaje: 10, rendimientosLocales: [] }],
  });

  it("cada línea del índice lleva la base de su versión", () => {
    expect(armarIndiceRecetas([receta("NETA")]).recetaPorProducto.get("plato")![0]!.baseDeCantidad).toBe("NETA");
    expect(armarIndiceRecetas([receta("BRUTA")]).recetaPorProducto.get("plato")![0]!.baseDeCantidad).toBe("BRUTA");
  });

  it.each([undefined, null, "", "neta", "MIXTA", 1])("lanza error explícito ante la marca %j (no asume una base ni omite la merma)", (mala) => {
    expect(() => armarIndiceRecetas([receta(mala)])).toThrow(/no es legible/);
  });
});
