import { redondearMoneda } from "@/core/moneda";
import { construirMapaProductos } from "@/core/reportes/public-servidor";
import type { Db } from "@/lib/db-tipos";
import { redondearCantidad } from "@/core/reportes/public";
import type { ReporteConsignacion } from "@/core/reportes/public";

/**
 * Port de generarReporteConsignacion_ (Reportes.js:993-1028), extendido con
 * un lado que Apps Script nunca tuvo: PagoConsignante. Antes, "Debido por
 * consignante" era solo SUM(LIQUIDACION_CONSIGNACION) de todo el historial
 * — no había ninguna forma de marcar un saldo como pagado, así que el
 * numero solo podía crecer para siempre (hallazgo de la auditoría de
 * motor2). Ahora: `importe` (saldo debido) = liquidado − pagado.
 *
 * `periodo` es opcional y filtra AMBOS lados (liquidaciones y pagos) por
 * `Operacion.fecha`/`PagoConsignante.fecha` — sin período, el resultado es
 * el saldo acumulado de siempre (comportamiento por defecto sin cambios);
 * con período, sirve para reconciliar el movimiento de un mes puntual con
 * el consignante, no para "el saldo a esa fecha" (eso requeriría sumar
 * todo lo anterior al período igual, que es exactamente el caso sin
 * filtro).
 *
 * El consignante de una liquidación es el de la MP CONSUMIDA
 * (`Producto.proveedorConsignacionId`), no `Operacion.proveedor` — ese
 * último es "a quién se le vende" (Venta) y es una Operacion COMPARTIDA
 * por todas las líneas que generó esa venta puntual (consumo + liquidación
 * incluidos), así que no sirve para identificar al consignante. Apps
 * Script no tenía este problema porque su Historial tiene una columna
 * "Proveedor" POR FILA (armarLineaLiquidacionConsignacion_,
 * Movimientos.js:1262) — acá no hace falta duplicar ese dato en
 * MovimientoStock: ya está en el Producto, fijo por definición.
 */
export async function generarReporteConsignacion(
  sucursalId: string,
  db: Db,
  periodo?: { desde?: Date; hasta?: Date }
): Promise<ReporteConsignacion> {
  const filtroFecha =
    periodo?.desde || periodo?.hasta
      ? { fecha: { ...(periodo.desde ? { gte: periodo.desde } : {}), ...(periodo.hasta ? { lte: periodo.hasta } : {}) } }
      : null;

  const [liquidaciones, pagos] = await Promise.all([
    db.movimientoStock.findMany({
      where: { proceso: "LIQUIDACION_CONSIGNACION", seccion: { sucursalId }, ...(filtroFecha ? { operacion: filtroFecha } : {}) },
      select: { precioTotal: true, producto: { select: { proveedorConsignacionId: true, proveedorConsignacion: { select: { nombre: true } } } } },
    }),
    db.pagoConsignante.findMany({
      where: { sucursalId, ...(filtroFecha ?? {}) },
      select: { importe: true, proveedorId: true, proveedor: { select: { nombre: true } } },
    }),
  ]);

  interface Acumulado {
    nombre: string;
    liquidado: number;
    pagado: number;
  }
  const CLAVE_SIN_PROVEEDOR = "__sin_proveedor__";
  const porConsignante = new Map<string, Acumulado>();

  for (const l of liquidaciones) {
    const clave = l.producto.proveedorConsignacionId ?? CLAVE_SIN_PROVEEDOR;
    const acc = porConsignante.get(clave) ?? { nombre: l.producto.proveedorConsignacion?.nombre ?? "(sin proveedor)", liquidado: 0, pagado: 0 };
    acc.liquidado += Number(l.precioTotal);
    porConsignante.set(clave, acc);
  }
  for (const p of pagos) {
    const acc = porConsignante.get(p.proveedorId) ?? { nombre: p.proveedor.nombre, liquidado: 0, pagado: 0 };
    acc.pagado += Number(p.importe);
    porConsignante.set(p.proveedorId, acc);
  }

  const debidoPorConsignante = Array.from(porConsignante.entries())
    .map(([clave, acc]) => ({
      proveedorId: clave === CLAVE_SIN_PROVEEDOR ? null : clave,
      proveedor: acc.nombre,
      liquidado: redondearMoneda(acc.liquidado),
      pagado: redondearMoneda(acc.pagado),
      importe: redondearMoneda(acc.liquidado - acc.pagado),
    }))
    .sort((a, b) => b.importe - a.importe);

  const productos = await construirMapaProductos(sucursalId, db);
  const saldos = await db.movimientoStock.groupBy({ by: ["productoId"], where: { seccion: { sucursalId } }, _sum: { cantidad: true } });
  const saldoPorProducto = new Map(saldos.map((s) => [s.productoId, Number(s._sum.cantidad ?? 0)]));

  const stockSinVender = Array.from(productos.values())
    .filter((p) => p.disponible && p.esConsignacion)
    .map((p) => ({
      productoId: p.id,
      producto: p.nombre,
      codigo: p.codigo,
      proveedorConsignacionNombre: p.proveedorConsignacionNombre,
      stockActual: redondearCantidad(saldoPorProducto.get(p.id) ?? 0),
    }))
    .sort((a, b) => a.producto.localeCompare(b.producto));

  return { debidoPorConsignante, stockSinVender };
}