import { prisma } from "@/lib/db";
import { redondearMoneda } from "@/core/movimientos/transiciones";
import { construirMapaProductos, redondearCantidad, type Db } from "./comun";

export interface FilaDebidoConsignante {
  proveedor: string;
  importe: number;
}
export interface FilaStockSinVenderConsignacion {
  productoId: string;
  producto: string;
  codigo: string;
  proveedorConsignacionNombre: string | null;
  stockActual: number;
}
export interface ReporteConsignacion {
  debidoPorConsignante: FilaDebidoConsignante[];
  stockSinVender: FilaStockSinVenderConsignacion[];
}

/**
 * Port de generarReporteConsignacion_ (Reportes.js:993-1028). Dos
 * preguntas: (1) cuánto se le debe a cada consignante — suma de las líneas
 * LIQUIDACION_CONSIGNACION del Kardex (las genera sola registrarVenta/
 * registrarMovimiento al consumir una MP `esConsignacion`, ver
 * TRANSICIONES.LIQUIDACION_CONSIGNACION); (2) cuánto stock en consignación
 * queda sin vender.
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
export async function generarReporteConsignacion(sucursalId: string, db: Db = prisma): Promise<ReporteConsignacion> {
  const liquidaciones = await db.movimientoStock.findMany({
    where: { proceso: "LIQUIDACION_CONSIGNACION", seccion: { sucursalId } },
    select: { precioTotal: true, producto: { select: { proveedorConsignacion: { select: { nombre: true } } } } },
  });

  const porConsignante = new Map<string, number>();
  for (const l of liquidaciones) {
    const proveedor = l.producto.proveedorConsignacion?.nombre ?? "(sin proveedor)";
    porConsignante.set(proveedor, (porConsignante.get(proveedor) ?? 0) + Number(l.precioTotal));
  }
  const debidoPorConsignante = Array.from(porConsignante.entries())
    .map(([proveedor, importe]) => ({ proveedor, importe: redondearMoneda(importe) }))
    .sort((a, b) => b.importe - a.importe);

  const productos = await construirMapaProductos(sucursalId, db);
  const saldos = await db.movimientoStock.groupBy({ by: ["productoId"], where: { seccion: { sucursalId } }, _sum: { cantidad: true } });
  const saldoPorProducto = new Map(saldos.map((s) => [s.productoId, Number(s._sum.cantidad ?? 0)]));

  const stockSinVender = Array.from(productos.values())
    .filter((p) => p.activo && p.esConsignacion)
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
