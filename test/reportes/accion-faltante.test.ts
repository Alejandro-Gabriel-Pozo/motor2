import { describe, expect, it } from "vitest";
import { resolverAccionFaltante, resolverAccionSinCostoReposicion } from "../../src/core/reportes/accion-faltante";
import type { ComponenteCosto } from "../../src/core/reportes/costos";

/**
 * «Qué hacer» ante un dato que falta en los reportes de costos. Fase 6 (6.13): el precio de venta que falta se carga en el paso 1 del espacio del producto, `/catalogo/productos/[id]/datos` (la ruta vieja
 * `/editar` redirige ahí, pero el enlace va directo: sin un salto de más).
 */
const sinComponentes: ComponenteCosto[] = [];
const componente = (c: Partial<ComponenteCosto>): ComponenteCosto => ({ insumoNombre: "Harina", insumoProductoId: "mp1", insumoSeProduce: false, sinPrecio: true, ...c }) as ComponenteCosto;

describe("resolverAccionFaltante", () => {
  it("sin precio de venta lleva al paso 1 (`/datos`) del producto, no a la ruta vieja `/editar`", () => {
    const accion = resolverAccionFaltante({ estado: "SIN_PRECIO_VENTA", productoId: "pv1", componentes: sinComponentes });
    expect(accion).toEqual({ href: "/catalogo/productos/pv1/datos", etiqueta: "Sin precio de venta — cargarlo" });
    expect(accion?.href).not.toContain("/editar");
  });

  it("sin receta sigue llevando a la receta, y un insumo que se produce, a SU receta (no a una compra)", () => {
    expect(resolverAccionFaltante({ estado: "SIN_RECETA", productoId: "pv1", componentes: sinComponentes })?.href).toBe("/catalogo/recetas/pv1");
    expect(resolverAccionFaltante({ estado: "COSTO_INCOMPLETO", productoId: "pv1", componentes: [componente({ insumoSeProduce: true, insumoProductoId: "masa" })] })?.href).toBe("/catalogo/recetas/masa");
    expect(resolverAccionFaltante({ estado: "COSTO_INCOMPLETO", productoId: "pv1", componentes: [componente({})] })?.href).toBe("/movimientos/compra?productoId=mp1");
  });

  it("un estado que no es «falta un dato» no tiene acción", () => {
    expect(resolverAccionFaltante({ estado: "OK", productoId: "pv1", componentes: sinComponentes })).toBeNull();
  });
});

describe("resolverAccionSinCostoReposicion", () => {
  it("un insumo que se produce va a su receta; uno que se compra, a cargar la compra", () => {
    expect(resolverAccionSinCostoReposicion("mp1", true).href).toBe("/catalogo/recetas/mp1");
    expect(resolverAccionSinCostoReposicion("mp1", false).href).toBe("/movimientos/compra?productoId=mp1");
  });
});
