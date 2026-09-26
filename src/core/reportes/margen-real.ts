import type { Proceso } from "@prisma/client";
import { redondearMoneda } from "@/core/movimientos/transiciones";
import { claveCostoHistorico, diaUtc, reconstruirCostosDeVenta } from "./costo-historico";
import type { Db, IndiceRecetas, InfoProductoReporte } from "./comun";

/**
 * Motor de costeo "real" línea a línea — extraído de `calcularMargenDelPeriodo` (src/core/reportes/periodo.ts), donde vivía sin
 * exportar (docs/plan-clientes-descuento-2026-09-26.md, punto 8). Refactor PURO: ni un número de `periodo.ts` cambia
 * (test/reportes/periodo.test.ts / promociones.test.ts lo verifican sin tocarlos).
 *
 * Reusable por cualquier reporte que necesite el costo REAL de una venta puntual — a diferencia del costo "nominal" (receta y precios
 * de HOY aplicados a todo lo vendido en el rango), esto resuelve, línea por línea, el costo vigente el día de esa venta:
 * - si la venta guardó su costo (`MovimientoStock.costoUnitarioVenta`), ese costo congelado manda;
 * - si no lo guardó, se RECONSTRUYE con el historial de compras (`costo-historico.ts`: receta de hoy × precio de la compra más
 *   reciente de cada insumo hasta ese día);
 * - si ninguna de las dos alcanza (algún insumo sin compras hasta ese día, o el plato sin receta), la línea queda afuera
 *   (`ingresoSinCostoReal`): no se inventa un costo parcial.
 *
 * Una venta cargada SIN precio (`precioTotal <= 0`) o ANULADA no entra: no tiene un ingreso con qué comparar su costo, o no ocurrió.
 * `ventasSinPrecioExcluidas` cuenta cuántas quedaron afuera por lo primero (para el aviso de quien llama).
 *
 * Primer consumidor nuevo: el reporte de descuentos por cliente (Task #14, `/reportes/descuentos-clientes`), que compara el margen
 * COBRADO (con el descuento del cliente) contra el margen A LISTA de la misma venta, con el mismo costo real de este módulo. Task #16
 * (promociones/combos) también lo va a importar por nombre — ver el reporte final del plan.
 */

export interface ItemParaMargenReal {
  proceso: Proceso;
  /** La operación de esta línea está anulada: no ocurrió, se saltea. */
  anulada: boolean;
  productoId: string;
  cantidad: number;
  precioTotal: number;
  costoUnitarioVenta: number | null;
  fecha: Date;
}

export interface FilaMargenRealProducto {
  ingresoConCostoReal: number;
  costoRealTotal: number;
  ingresoRealReconstruido: number;
}

export interface MargenRealDelPeriodo {
  ingresoConCostoReal: number;
  costoRealTotal: number;
  ingresoSinCostoReal: number;
  ingresoRealReconstruido: number;
  /** Ventas VENTA no anuladas cargadas con `precioTotal <= 0` (sin precio): no entran a nada de lo de arriba. */
  ventasSinPrecioExcluidas: number;
  /** `ingresoConCostoReal > 0` — hay al menos una línea costeada. */
  hayCostoReal: boolean;
  margenRealTotal: number | null;
  /** `ingresoConCostoReal / (ingresoConCostoReal + ingresoSinCostoReal)`, en %. `null` sin ninguna base. */
  coberturaCostoRealPct: number | null;
  /** Acumulado por producto — SIN redondear (quien consume redondea al usarlo, mismo criterio que el resto de este módulo). */
  porProducto: Map<string, FilaMargenRealProducto>;
}

/**
 * Costea `items` (ya filtrados al proceso/rango/sucursal que corresponda por quien llama) con el criterio de arriba. NO filtra por
 * sucursal ni por rango: eso es responsabilidad de quien arma `items` — esta función solo decide, línea a línea, con qué costo
 * comparar cada una.
 */
export async function calcularMargenRealDelPeriodo(
  sucursalId: string,
  items: readonly ItemParaMargenReal[],
  db: Db,
  /** El catálogo ya cargado de la misma sucursal, para no volver a leerlo (ver `calcularCostosYMargenes`). */
  productos?: Map<string, InfoProductoReporte>,
  /** El índice de recetas ya cargado, mismo motivo (ver `obtenerReportePorPeriodoConCatalogo`). */
  indiceRecetas?: IndiceRecetas
): Promise<MargenRealDelPeriodo> {
  let ingresoConCostoReal = 0;
  let costoRealTotal = 0;
  let ingresoSinCostoReal = 0;
  let ingresoRealReconstruido = 0;

  const ventasSinPrecioExcluidas = items.filter((it) => it.proceso === "VENTA" && !it.anulada && it.precioTotal <= 0).length;
  const ventasSinCosto = items.filter((it) => it.proceso === "VENTA" && !it.anulada && it.precioTotal > 0 && it.costoUnitarioVenta === null);
  const costosReconstruidos = await reconstruirCostosDeVenta(sucursalId, ventasSinCosto, db, productos, indiceRecetas);

  const porProducto = new Map<string, FilaMargenRealProducto>();
  for (const it of items) {
    if (it.proceso !== "VENTA" || it.anulada || it.precioTotal <= 0) continue;
    const acc = porProducto.get(it.productoId) ?? { ingresoConCostoReal: 0, costoRealTotal: 0, ingresoRealReconstruido: 0 };
    porProducto.set(it.productoId, acc);
    if (it.costoUnitarioVenta !== null) {
      ingresoConCostoReal += it.precioTotal;
      costoRealTotal += it.cantidad * it.costoUnitarioVenta;
      acc.ingresoConCostoReal += it.precioTotal;
      acc.costoRealTotal += it.cantidad * it.costoUnitarioVenta;
      continue;
    }
    const reconstruido = costosReconstruidos.get(claveCostoHistorico(it.productoId, diaUtc(it.fecha))) ?? null;
    if (reconstruido !== null) {
      ingresoConCostoReal += it.precioTotal;
      ingresoRealReconstruido += it.precioTotal;
      costoRealTotal += it.cantidad * reconstruido;
      acc.ingresoConCostoReal += it.precioTotal;
      acc.ingresoRealReconstruido += it.precioTotal;
      acc.costoRealTotal += it.cantidad * reconstruido;
    } else {
      ingresoSinCostoReal += it.precioTotal;
    }
  }

  const hayCostoReal = ingresoConCostoReal > 0;
  const margenRealTotal = hayCostoReal ? redondearMoneda(ingresoConCostoReal - costoRealTotal) : null;
  const baseCobertura = ingresoConCostoReal + ingresoSinCostoReal;
  const coberturaCostoRealPct = baseCobertura > 0 ? Math.round((ingresoConCostoReal / baseCobertura) * 1000) / 10 : null;

  return { ingresoConCostoReal, costoRealTotal, ingresoSinCostoReal, ingresoRealReconstruido, ventasSinPrecioExcluidas, hayCostoReal, margenRealTotal, coberturaCostoRealPct, porProducto };
}
