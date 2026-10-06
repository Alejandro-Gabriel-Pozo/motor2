import { redondearMoneda } from "@/core/moneda";
import { type InfoProductoReporte } from "./comun";
import { redondearCantidad } from "./redondeo";
import type { ItemPeriodo } from "./periodo-tipos";

export interface FilaVentaProducto {
  productoId: string;
  producto: string;
  cantidad: number;
  importe: number;
  precioUnitario: number;
  estimado: boolean;
}
export interface VentasDelPeriodo {
  totalFacturado: number;
  porProducto: FilaVentaProducto[];
  aviso: string;
}

/**
 * Port de calcularVentasDelPeriodo_ (Reportes.js:190-229). Una línea con
 * Precio Total > 0 es el importe REAL de esa venta puntual; una con 0 es
 * una venta vieja sin precio guardado por línea y se estima al precio de
 * venta VIGENTE (ya resuelto con Precio Local — ver construirMapaProductos)
 * — marcada `estimado` para que la UI no la confunda con un importe real.
 */
export function calcularVentasDelPeriodo(items: ItemPeriodo[], productos: Map<string, InfoProductoReporte>): VentasDelPeriodo {
  const porProducto = new Map<string, { producto: string; cantidad: number; importe: number; precioUnitario: number; estimado: boolean }>();
  let totalFacturado = 0;

  for (const r of items) {
    if (r.proceso !== "VENTA" || r.anulada) continue;
    const esReal = r.precioTotal > 0;
    const precioVentaVigente = productos.get(r.productoId)?.precioVenta ?? 0;
    const importe = esReal ? r.precioTotal : r.cantidad * precioVentaVigente;
    const precioUnitario = esReal ? r.precioPorUnidadStock : precioVentaVigente;
    totalFacturado += importe;

    if (!porProducto.has(r.productoId)) porProducto.set(r.productoId, { producto: r.productoNombre, cantidad: 0, importe: 0, precioUnitario, estimado: false });
    const acc = porProducto.get(r.productoId)!;
    acc.cantidad += r.cantidad;
    acc.importe += importe;
    acc.precioUnitario = precioUnitario;
    if (!esReal) acc.estimado = true;
  }

  const hayEstimados = Array.from(porProducto.values()).some((v) => v.estimado);

  return {
    totalFacturado: redondearMoneda(totalFacturado),
    porProducto: Array.from(porProducto.entries())
      .map(([productoId, v]) => ({ productoId, ...v, cantidad: redondearCantidad(v.cantidad), importe: redondearMoneda(v.importe) }))
      .sort((a, b) => b.importe - a.importe),
    aviso: hayEstimados
      ? "Incluye ventas cargadas ANTES de guardar el precio real por línea: se valorizan al precio de venta VIGENTE hoy (marcadas como estimadas)."
      : "Importe real registrado en cada venta (no una estimación).",
  };
}
