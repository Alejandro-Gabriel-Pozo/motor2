import { redondearMoneda } from "@/core/moneda";
import { type InfoProductoReporte } from "./comun";
import { redondearCantidad } from "./redondeo";

export interface FilaCategoriaVenta {
  categoria: string;
  cantidad: number;
  importe: number;
  productos: { producto: string; cantidad: number; importe: number }[];
}

/** Una venta del período ya con el nombre de su categoría (null = sin categoría). */
export interface VentaConCategoria {
  producto: string;
  categoria: string | null;
  cantidad: number;
  importe: number;
}

/**
 * Pura: agrupa ventas por producto en filas de categoría (los PV sin categoría, en "Sin categoría"), con sus totales redondeados y
 * todo por importe descendente. La usan «Ventas por categoría» y «Ventas por sección de carta» (src/core/carta/reporte-secciones.ts,
 * que la aplica a las ventas de CADA sección), para que las dos agrupen igual.
 */
export function agruparVentasPorCategoria(ventas: readonly VentaConCategoria[]): FilaCategoriaVenta[] {
  const porCategoria = new Map<string, { cantidad: number; importe: number; productos: { producto: string; cantidad: number; importe: number }[] }>();
  for (const v of ventas) {
    const categoria = v.categoria ?? "Sin categoría";
    if (!porCategoria.has(categoria)) porCategoria.set(categoria, { cantidad: 0, importe: 0, productos: [] });
    const acc = porCategoria.get(categoria)!;
    acc.cantidad += v.cantidad;
    acc.importe += v.importe;
    acc.productos.push({ producto: v.producto, cantidad: v.cantidad, importe: v.importe });
  }
  return Array.from(porCategoria.entries())
    .map(([categoria, c]) => ({ categoria, cantidad: redondearCantidad(c.cantidad), importe: redondearMoneda(c.importe), productos: c.productos.sort((a, b) => b.importe - a.importe) }))
    .sort((a, b) => b.importe - a.importe);
}

/** Los PV disponibles en la sucursal sin categoría asignada (nombres, orden alfabético). */
export function pvSinCategoriaDe(productos: ReadonlyMap<string, InfoProductoReporte>): string[] {
  return Array.from(productos.values())
    .filter((p) => p.tipo === "PV" && p.disponible && !p.categoriaNombre)
    .map((p) => p.nombre)
    .sort((a, b) => a.localeCompare(b));
}
