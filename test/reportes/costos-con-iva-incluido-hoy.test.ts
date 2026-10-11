import { describe, expect, it } from "vitest";
import { calcularCostosYMargenesDesde } from "../../src/core/reportes/costos";
import { FOOD_COST_OBJETIVO_PCT } from "../../src/core/reportes/margen-objetivo";
import type { CostoMP, IngredienteRecetaReporte, InfoProductoReporte } from "../../src/core/reportes/comun";

/**
 * IVA-4 — caracterización, SIN base de datos: HOY, con IVA incluido; se cambia a propósito en la Etapa C.
 *
 * Hoy el cálculo de costos y márgenes usa los dos números tal como están guardados: el precio de venta es el de la carta (con IVA incluido) y el
 * costo es lo pagado al proveedor (`precioTotal`, también con IVA incluido; no hay nada de IVA en ningún renglón). Ejemplo del grounding
 * (`grounding-iva-y-alicuotas.md`): un plato de $1.210 (neto $1.000 + IVA 21 %) con 1 kg de un insumo comprado con factura A a $552,50 (neto $500 + IVA
 * 10,5 %). Contado SIN IVA el plato daría margen 500 sobre 1000 (50 %) y food cost 50 %; contado como HOY, con IVA en los dos lados, da lo de abajo. Si
 * un cambio hace que este test falle, está cambiando lo que ven los reportes: la Etapa C lo cambia a propósito (y actualiza este archivo), no por
 * accidente. Lo que el golden `reportes-c0` (entradas 6 y 42) y `valuacion.test.ts` fijan con base no se repite acá.
 */
describe("costos y márgenes HOY (precio de venta y costo con IVA incluido)", () => {
  const kg = "kg";
  const insumo: InfoProductoReporte = {
    id: "mp-1",
    codigo: "MP_IVA",
    nombre: "Carne",
    tipo: "MP",
    disponible: true,
    seProduce: false,
    precioVenta: 0,
    categoriaNombre: null,
    categoriaId: null,
    insumoNombre: null,
    grupoNombre: null,
    esNoComestible: false,
    unidadStockNombre: kg,
    esConsignacion: false,
    proveedorConsignacionNombre: null,
  };
  const plato: InfoProductoReporte = { ...insumo, id: "pv-1", codigo: "PV_IVA", nombre: "Plato", tipo: "PV", precioVenta: 1210 };
  const ingrediente: IngredienteRecetaReporte = {
    recetaIngredienteId: "ri-1",
    insumoProductoId: insumo.id,
    insumoNombre: insumo.nombre,
    cantidad: 1,
    unidadNombre: kg,
    mermaPorcentaje: 0,
    cantidadCentral: 1,
    mermaPorcentajeCentral: 0,
    calibradoLocal: false,
  };
  const costo: CostoMP = { precioPorUnidadStock: 552.5, proveedorNombre: "Proveedor", fecha: new Date("2026-01-01") };

  it("el margen, el food cost y el precio para el objetivo salen del precio de venta y del costo tal cual están (ambos con IVA)", () => {
    const filas = calcularCostosYMargenesDesde(
      new Map([
        [insumo.id, insumo],
        [plato.id, plato],
      ]),
      new Map([[plato.id, [ingrediente]]]),
      new Map([[insumo.id, costo]])
    );

    expect(filas).toHaveLength(1);
    const fila = filas[0];
    expect(fila.precioVenta).toBe(1210);
    expect(fila.costo).toBe(552.5);
    expect(fila.margen).toBe(657.5); // 1210 − 552,50 (sin IVA serían 1000 − 500 = 500)
    expect(fila.margenPct).toBe(54.3); // 657,5 / 1210 (sin IVA: 50 %)
    expect(fila.foodCostPct).toBe(45.7); // 552,5 / 1210 (sin IVA: 50 %)
    expect(fila.objetivoFoodCostPct).toBe(FOOD_COST_OBJETIVO_PCT);
    expect(fila.precioSugerido).toBe(1381.25); // 552,5 / objetivo, con IVA incluido como el precio de venta
    expect(fila.estado).toBe("FOOD_COST_ALTO");
  });
});
