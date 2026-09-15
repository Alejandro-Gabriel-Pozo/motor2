import { prisma } from "@/lib/db";
import { obtenerResumenAlertasStock } from "@/core/stock/alertas";
import { redondearCantidad, type Db } from "./comun";
import { obtenerReportePorPeriodo } from "./periodo";

/** Primer día del mes calendario actual, en UTC (ver la nota de rangoUtc en periodo.ts). */
function primerDiaDelMes(): Date {
  const hoy = new Date();
  return new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1));
}

export interface ResumenFinancieroMes {
  desde: Date;
  hasta: Date;
  ventasTotal: number;
  margenTotal: number;
  margenPct: number | null;
  costoTotal: number;
  hayEstimados: boolean;
  hayCostoIncompleto: boolean;
  topProductos: { producto: string; importe: number }[];
  gastadoTotal: number;
  hayComprasSinPrecio: boolean;
  topProveedores: { proveedor: string; importe: number }[];
}

/** Port de obtenerResumenFinancieroMesActual_ (Reportes.js:1507-1528). */
export async function obtenerResumenFinancieroMesActual(sucursalId: string, db: Db = prisma): Promise<ResumenFinancieroMes> {
  const desde = primerDiaDelMes();
  const hoy = new Date();
  const rep = await obtenerReportePorPeriodo(sucursalId, desde, hoy, {}, db);

  return {
    desde: rep.desde,
    hasta: rep.hasta,
    ventasTotal: rep.ventas.totalFacturado,
    margenTotal: rep.margen.margenTotal,
    margenPct: rep.margen.margenPctTotal,
    costoTotal: rep.margen.costoTotal,
    hayEstimados: rep.ventas.porProducto.some((v) => v.estimado),
    hayCostoIncompleto: rep.margen.hayCostoIncompleto,
    topProductos: rep.ventas.porProducto.slice(0, 5).map((v) => ({ producto: v.producto, importe: v.importe })),
    gastadoTotal: rep.compras.totalGastado,
    hayComprasSinPrecio: rep.compras.hayComprasSinPrecio,
    topProveedores: rep.compras.porProveedor.slice(0, 5).map((p) => ({ proveedor: p.proveedor, importe: p.importe })),
  };
}

export interface ResumenOperativo {
  stock: { totalItems: number; negativos: number; secciones: Record<string, number> };
  alertas: { total: number; criticos: number; bajos: number };
  movimientos: { total: number; porProceso: Record<string, number> };
  topStockBajo: { producto: string; saldo: number; seccion: string }[];
  financiero: ResumenFinancieroMes;
}

/**
 * Port de obtenerResumenOperativo (Reportes.js:1460-1496) — dashboard
 * básico. `stock`/`topStockBajo` leen el LIBRO MAYOR (solo lo que YA tuvo
 * movimiento, mismo criterio que calcularStockActual_ en Apps Script), a
 * diferencia de Stock Consolidado que hace LEFT JOIN contra todo el
 * catálogo — acá interesa "qué se está moviendo", no la foto completa.
 */
export async function obtenerResumenOperativo(sucursalId: string, db: Db = prisma): Promise<ResumenOperativo> {
  const [saldos, movimientosPorProceso, alertas, financiero] = await Promise.all([
    db.movimientoStock.groupBy({ by: ["productoId", "seccionId"], where: { seccion: { sucursalId } }, _sum: { cantidad: true } }),
    db.movimientoStock.groupBy({ by: ["proceso"], where: { seccion: { sucursalId } }, _count: { _all: true } }),
    obtenerResumenAlertasStock(sucursalId, db),
    obtenerResumenFinancieroMesActual(sucursalId, db),
  ]);

  const productoIds = Array.from(new Set(saldos.map((s) => s.productoId)));
  const seccionIds = Array.from(new Set(saldos.map((s) => s.seccionId)));
  const [productos, secciones] = await Promise.all([
    db.producto.findMany({ where: { id: { in: productoIds } } }),
    db.seccion.findMany({ where: { id: { in: seccionIds } } }),
  ]);
  const productoPorId = new Map(productos.map((p) => [p.id, p]));
  const seccionPorId = new Map(secciones.map((s) => [s.id, s]));

  const porSeccion: Record<string, number> = {};
  let negativos = 0;
  const bajos: { producto: string; saldo: number; seccion: string }[] = [];
  for (const s of saldos) {
    const seccionNombre = seccionPorId.get(s.seccionId)?.nombre ?? "";
    porSeccion[seccionNombre] = (porSeccion[seccionNombre] ?? 0) + 1;
    const saldo = Number(s._sum.cantidad ?? 0);
    if (saldo < 0) negativos += 1;
    if (saldo <= 0) bajos.push({ producto: productoPorId.get(s.productoId)?.nombre ?? "", saldo: redondearCantidad(saldo), seccion: seccionNombre });
  }

  const porProceso: Record<string, number> = {};
  for (const m of movimientosPorProceso) porProceso[m.proceso] = m._count._all;

  return {
    stock: { totalItems: saldos.length, negativos, secciones: porSeccion },
    alertas: { total: alertas.total, criticos: alertas.criticos, bajos: alertas.bajos },
    movimientos: { total: Object.values(porProceso).reduce((a, b) => a + b, 0), porProceso },
    topStockBajo: bajos.slice(0, 10),
    financiero,
  };
}
