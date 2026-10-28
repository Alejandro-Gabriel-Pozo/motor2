import { Decimal } from "decimal.js";
import { type CostoMP } from "./comun";

/**
 * «Margen real» para ventas que no guardaron su costo al venderse (por ejemplo, las que se cargaron sin ese dato): se RECONSTRUYE
 * el costo de cada plato al día de la venta con el historial de entradas valorizadas (compras y, desde E2, traspasos recibidos: V-T1), con
 * el mismo criterio del costo de reposición de Costos y márgenes (`obtenerCostoActualPorMP`: el precio por unidad de la entrada más reciente
 * de cada insumo), pero «más reciente hasta ese día» en vez de «más reciente hoy». Es una aproximación, y por eso el reporte la rotula «reconstruido»:
 * - usa la receta VIGENTE hoy (no la que regía ese día);
 * - si un insumo no tiene ninguna compra hasta ese día, el plato no se puede costear y la venta queda afuera (no se inventa un valor).
 */
export interface CompraConPrecio {
  productoId: string;
  fecha: Date;
  precioPorUnidadStock: number;
}

/** Día (YYYY-MM-DD, UTC) de una fecha: la unidad con la que se compara «hasta ese día». */
export function diaUtc(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

/**
 * Para cada día pedido, el costo de reposición de cada insumo AL FINAL de ese día: el precio de su compra más reciente hasta ese día
 * (inclusive). Una sola pasada sobre las compras ordenadas y los días ordenados, sin una consulta por día.
 */
export function costosDeInsumosPorDia(compras: CompraConPrecio[], dias: string[]): Map<string, Map<string, CostoMP>> {
  const ordenadas = [...compras].sort((a, b) => a.fecha.getTime() - b.fecha.getTime());
  const diasOrdenados = [...new Set(dias)].sort();
  const resultado = new Map<string, Map<string, CostoMP>>();
  const vigente = new Map<string, CostoMP>();

  let i = 0;
  for (const dia of diasOrdenados) {
    while (i < ordenadas.length && diaUtc(ordenadas[i].fecha) <= dia) {
      const c = ordenadas[i++];
      vigente.set(c.productoId, { precioPorUnidadStock: c.precioPorUnidadStock, proveedorNombre: null, fecha: c.fecha });
    }
    resultado.set(dia, new Map(vigente));
  }
  return resultado;
}

export function claveCostoHistorico(productoId: string, dia: string): string {
  return `${productoId}|${dia}`;
}

/**
 * GO-2b (ADR-030): la clave del costo reconstruido de UNA línea configurada (o de un adicional): es de SU operación, no del (producto, día) — su consumo lo
 * escribió la configuración y no es el de la receta del producto base.
 */
export function claveCostoDeLineaConfigurada(operacionId: string): string {
  return `op|${operacionId}`;
}

const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

/**
 * GO-2b: el costo por unidad de una línea configurada SIN costo congelado, reconstruido con los CONSUMO de su propia operación por el costo del día de cada insumo
 * (decimal exacto): Σ |cantidad consumida| × costo, sobre la cantidad vendida. `null` si falta el costo de algún insumo, no hay consumos o no hay cantidad. Nunca
 * con la receta del producto base.
 */
export function costoDeLineaConfiguradaDesdeConsumos(
  consumos: readonly { productoId: string; cantidad: number }[],
  cantidadVendida: number,
  costoDeInsumo: (productoId: string) => number | null
): number | null {
  if (consumos.length === 0 || !(cantidadVendida > 0)) return null;
  let total = new D(0);
  for (const c of consumos) {
    const costo = costoDeInsumo(c.productoId);
    if (costo === null) return null;
    total = total.plus(new D(c.cantidad).abs().times(costo));
  }
  return total.dividedBy(cantidadVendida).toNumber();
}
