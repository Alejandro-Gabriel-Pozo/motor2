import { prisma } from "@/lib/db";
import { construirIndiceRecetas, construirMapaProductos, type CostoMP, type Db } from "./comun";
import { resolverCostoRecetaCompleta } from "./costos";

/**
 * «Margen real» para ventas que no guardaron su costo al venderse (por ejemplo, las que se cargaron sin ese dato): se RECONSTRUYE
 * el costo de cada plato al día de la venta con el historial de compras, con el mismo criterio del costo de reposición de
 * Costos y márgenes (`obtenerCostoActualPorMP`: el precio por unidad de la compra más reciente de cada insumo), pero «más reciente
 * hasta ese día» en vez de «más reciente hoy». Es una aproximación, y por eso el reporte la rotula «reconstruido»:
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

/**
 * Costo unitario reconstruido de cada (plato, día) pedido. `null` = no se pudo costear (algún insumo sin compras hasta ese día, o
 * el plato sin receta). La clave es `${productoId}|${YYYY-MM-DD}` (ver `claveCostoHistorico`).
 */
export async function reconstruirCostosDeVenta(
  sucursalId: string,
  ventas: { productoId: string; fecha: Date }[],
  db: Db = prisma
): Promise<Map<string, number | null>> {
  const resultado = new Map<string, number | null>();
  if (!ventas.length) return resultado;

  const dias = ventas.map((v) => diaUtc(v.fecha));
  const ultimoDia = [...dias].sort().at(-1)!;
  const [productos, { recetaPorProducto }, compras] = await Promise.all([
    construirMapaProductos(sucursalId, db),
    construirIndiceRecetas(db),
    db.movimientoStock.findMany({
      where: {
        proceso: "COMPRA",
        seccion: { sucursalId },
        precioPorUnidadStock: { gt: 0 },
        operacion: { fecha: { lt: new Date(new Date(`${ultimoDia}T00:00:00Z`).getTime() + 86_400_000) } },
      },
      select: { productoId: true, precioPorUnidadStock: true, operacion: { select: { fecha: true } } },
    }),
  ]);

  const costosPorDia = costosDeInsumosPorDia(
    compras.map((c) => ({ productoId: c.productoId, fecha: c.operacion.fecha, precioPorUnidadStock: Number(c.precioPorUnidadStock) })),
    dias
  );

  for (const v of ventas) {
    const clave = claveCostoHistorico(v.productoId, diaUtc(v.fecha));
    if (resultado.has(clave)) continue;
    resultado.set(clave, resolverCostoRecetaCompleta(v.productoId, productos, recetaPorProducto, costosPorDia.get(diaUtc(v.fecha)) ?? new Map()));
  }
  return resultado;
}

export function claveCostoHistorico(productoId: string, dia: string): string {
  return `${productoId}|${dia}`;
}
