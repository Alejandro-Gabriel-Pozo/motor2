import { obtenerResumenAlertasStock } from "@/core/stock/alertas";
import { redondearCantidad, type Db } from "./comun";
import { obtenerReportePorPeriodo } from "./periodo";
import { resolverRangoPorDefecto } from "./rango-por-defecto";

export interface ResumenFinanciero {
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
  /** Ver el docstring de MargenDelPeriodo.margenRealTotal en periodo.ts. */
  margenRealTotal: number | null;
  margenRealPct: number | null;
  /** «Real» incluye ventas cuyo costo se reconstruyó con el historial de compras (no se guardó al venderse). */
  margenRealReconstruido: boolean;
  /** Ver el docstring de MargenDelPeriodo.margenIPCTotal en periodo.ts. */
  margenIPCTotal: number | null;
  margenIPCPct: number | null;
  /** El ajuste por IPC incluye ventas de un mes que el INDEC todavía no publicó (provisorio). */
  margenIPCProvisorio: boolean;
  /** La serie del IPC está parada hace más del máximo previsto (5c): el ajuste no es «de hoy». Gana sobre `margenIPCProvisorio` en el rótulo. */
  ipcVencido: boolean;
  avisoVentas: string;
  avisoMargen: string;
  avisoMargenReal: string;
  avisoMargenIPC: string;
  avisoCompras: string;
}

/**
 * Port de obtenerResumenFinancieroMesActual_ (Reportes.js:1507-1528), adaptado para aceptar cualquier rango en vez de fijar
 * "mes en curso" — decisión del usuario (2026-09-21, docs/planes-demo-y-claridad-reportes-2026-09-21.md §1): el default del
 * dashboard pasa a ser "Últimos 30 días". Sin `rango`, cae al mismo default (ver rango-por-defecto.ts).
 */
async function obtenerResumenFinancieroDelRango(sucursalId: string, desde: Date, hasta: Date, db: Db): Promise<ResumenFinanciero> {
  const rep = await obtenerReportePorPeriodo(sucursalId, desde, hasta, {}, db);

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
    margenRealTotal: rep.margen.margenRealTotal,
    margenRealPct: rep.margen.margenRealPctTotal,
    margenRealReconstruido: rep.margen.ingresoRealReconstruido > 0,
    margenIPCTotal: rep.margen.margenIPCTotal,
    margenIPCPct: rep.margen.margenIPCPctTotal,
    margenIPCProvisorio: rep.margen.ingresoProvisorioIPC > 0,
    ipcVencido: rep.margen.antiguedadIPC.estado === "vencida",
    avisoVentas: rep.ventas.aviso,
    avisoMargen: rep.margen.aviso,
    avisoMargenReal: rep.margen.avisoReal,
    avisoMargenIPC: rep.margen.avisoIPC,
    avisoCompras: rep.compras.aviso,
  };
}

export interface ResumenOperativo {
  stock: { totalItems: number; negativos: number; secciones: Record<string, number> };
  alertas: { total: number; criticos: number; bajos: number };
  movimientos: { total: number; porProceso: Record<string, number> };
  topStockBajo: { producto: string; saldo: number; seccion: string }[];
  financiero: ResumenFinanciero;
}

/**
 * Port de obtenerResumenOperativo (Reportes.js:1460-1496) — dashboard
 * básico. `stock`/`topStockBajo` leen el LIBRO MAYOR (solo lo que YA tuvo
 * movimiento, mismo criterio que calcularStockActual_ en Apps Script), a
 * diferencia de Stock Consolidado que hace LEFT JOIN contra todo el
 * catálogo — acá interesa "qué se está moviendo", no la foto completa.
 *
 * El financiero usa el rango recibido; sin uno explícito cae al default del selector (últimos 30 días) para que `financiero`
 * nunca quede vacío por casualidad de calendario (ver rango-por-defecto.ts).
 */
export async function obtenerResumenOperativo(sucursalId: string, db: Db, ahora: Date, rango?: { desde: Date; hasta: Date }): Promise<ResumenOperativo> {
  const { desde: desdeFinanciero, hasta: hastaFinanciero } = rango ?? (() => {
    const r = resolverRangoPorDefecto(undefined, ahora);
    return { desde: new Date(r.desdeISO), hasta: new Date(r.hastaISO) };
  })();
  const [saldos, movimientosPorProceso, alertas, financiero] = await Promise.all([
    db.movimientoStock.groupBy({ by: ["productoId", "seccionId"], where: { seccion: { sucursalId } }, _sum: { cantidad: true } }),
    db.movimientoStock.groupBy({ by: ["proceso"], where: { seccion: { sucursalId } }, _count: { _all: true } }),
    obtenerResumenAlertasStock(sucursalId, db),
    obtenerResumenFinancieroDelRango(sucursalId, desdeFinanciero, hastaFinanciero, db),
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
