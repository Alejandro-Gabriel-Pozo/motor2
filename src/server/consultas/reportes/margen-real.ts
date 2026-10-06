import { redondearMoneda } from "@/core/moneda";
import { claveCostoHistorico, diaUtc, type IndiceRecetas, type InfoProductoReporte } from "@/core/reportes/public";
import { reconstruirCostosDeVenta } from "@/server/consultas/reportes/costo-historico";
import type { Db } from "@/lib/db-tipos";
import type { ItemParaMargenReal, FilaMargenRealProducto, MargenRealDelPeriodo } from "@/core/reportes/public";

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
  indiceRecetas?: IndiceRecetas,
  /** Los costos de venta ya reconstruidos (clave `claveCostoHistorico`): quien costea MUCHOS grupos de ventas (p. ej. un grupo por cliente) los reconstruye UNA vez para todos y se los pasa, en vez de que cada llamada lea el historial de compras. Sin esto, se reconstruyen acá. */
  costosReconstruidosDeAntemano?: ReadonlyMap<string, number | null>
): Promise<MargenRealDelPeriodo> {
  let ingresoConCostoReal = 0;
  let costoRealTotal = 0;
  let ingresoSinCostoReal = 0;
  let ingresoRealReconstruido = 0;

  const ventasSinPrecioExcluidas = items.filter((it) => it.proceso === "VENTA" && !it.anulada && it.precioTotal <= 0).length;
  const ventasSinCosto = items.filter((it) => it.proceso === "VENTA" && !it.anulada && it.precioTotal > 0 && it.costoUnitarioVenta === null);
  const costosReconstruidos = costosReconstruidosDeAntemano ?? (await reconstruirCostosDeVenta(sucursalId, ventasSinCosto, db, productos, indiceRecetas));

  const porProducto = new Map<string, FilaMargenRealProducto>();
  const costoPorItem: (number | null)[] = new Array(items.length).fill(null);
  items.forEach((it, i) => {
    if (it.proceso !== "VENTA" || it.anulada || it.precioTotal <= 0) return;
    const acc = porProducto.get(it.productoId) ?? { ingresoConCostoReal: 0, costoRealTotal: 0, ingresoRealReconstruido: 0 };
    porProducto.set(it.productoId, acc);
    if (it.costoUnitarioVenta !== null) {
      const costo = it.cantidad * it.costoUnitarioVenta;
      ingresoConCostoReal += it.precioTotal;
      costoRealTotal += costo;
      acc.ingresoConCostoReal += it.precioTotal;
      acc.costoRealTotal += costo;
      costoPorItem[i] = costo;
      return;
    }
    const reconstruido = costosReconstruidos.get(claveCostoHistorico(it.productoId, diaUtc(it.fecha))) ?? null;
    if (reconstruido !== null) {
      const costo = it.cantidad * reconstruido;
      ingresoConCostoReal += it.precioTotal;
      ingresoRealReconstruido += it.precioTotal;
      costoRealTotal += costo;
      acc.ingresoConCostoReal += it.precioTotal;
      acc.ingresoRealReconstruido += it.precioTotal;
      acc.costoRealTotal += costo;
      costoPorItem[i] = costo;
    } else {
      ingresoSinCostoReal += it.precioTotal;
    }
  });

  const hayCostoReal = ingresoConCostoReal > 0;
  const margenRealTotal = hayCostoReal ? redondearMoneda(ingresoConCostoReal - costoRealTotal) : null;
  const baseCobertura = ingresoConCostoReal + ingresoSinCostoReal;
  const coberturaCostoRealPct = baseCobertura > 0 ? Math.round((ingresoConCostoReal / baseCobertura) * 1000) / 10 : null;

  return { ingresoConCostoReal, costoRealTotal, ingresoSinCostoReal, ingresoRealReconstruido, ventasSinPrecioExcluidas, hayCostoReal, margenRealTotal, coberturaCostoRealPct, porProducto, costoPorItem };
}