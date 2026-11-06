import { redondearMoneda } from "@/core/moneda";
import { redondearCantidad } from "./redondeo";
import type { ItemPeriodo } from "./periodo-tipos";

export interface FilaVentaProducto {
  productoId: string;
  producto: string;
  cantidad: number;
  importe: number;
  precioUnitario: number;
}
export interface VentasDelPeriodo {
  totalFacturado: number;
  porProducto: FilaVentaProducto[];
  /** Ventas no anuladas con importe $0: «sin dato». Quedan FUERA del total y de `porProducto` (nunca se estiman); acá solo se cuentan para avisarlo. */
  lineasSinDato: number;
  aviso: string;
}

/**
 * Port de calcularVentasDelPeriodo_ (Reportes.js:190-229), con la decisión del dueño del 2026-11-06 (lote 1b, hallazgo C): las ventas quedan CONGELADAS. Una línea con Precio Total > 0 es el importe REAL
 * de esa venta puntual; una con 0 significa «sin dato» y nada más: NO se revalúa al precio de venta de hoy, no suma al total ni a las filas (igual que el margen Real, que ya la excluye) y se cuenta
 * en `lineasSinDato` para que la pantalla lo diga. El total nunca depende del precio de lista vigente.
 */
export function calcularVentasDelPeriodo(items: ItemPeriodo[]): VentasDelPeriodo {
  const porProducto = new Map<string, { producto: string; cantidad: number; importe: number; precioUnitario: number }>();
  let totalFacturado = 0;
  let lineasSinDato = 0;

  for (const r of items) {
    if (r.proceso !== "VENTA" || r.anulada) continue;
    if (!(r.precioTotal > 0)) {
      lineasSinDato += 1;
      continue;
    }
    totalFacturado += r.precioTotal;

    if (!porProducto.has(r.productoId)) porProducto.set(r.productoId, { producto: r.productoNombre, cantidad: 0, importe: 0, precioUnitario: r.precioPorUnidadStock });
    const acc = porProducto.get(r.productoId)!;
    acc.cantidad += r.cantidad;
    acc.importe += r.precioTotal;
    acc.precioUnitario = r.precioPorUnidadStock;
  }

  return {
    totalFacturado: redondearMoneda(totalFacturado),
    porProducto: Array.from(porProducto.entries())
      .map(([productoId, v]) => ({ productoId, ...v, cantidad: redondearCantidad(v.cantidad), importe: redondearMoneda(v.importe) }))
      .sort((a, b) => b.importe - a.importe),
    lineasSinDato,
    aviso:
      lineasSinDato > 0
        ? `${lineasSinDato} ${lineasSinDato === 1 ? "venta sin importe registrado queda" : "ventas sin importe registrado quedan"} FUERA de estos totales (sin dato): no se estiman al precio de hoy.`
        : "Importe real registrado en cada venta (no una estimación).",
  };
}
