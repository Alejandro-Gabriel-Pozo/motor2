import { prisma } from "@/lib/db";
import { redondearMoneda } from "@/core/movimientos/transiciones";
import { obtenerCostoActualPorMP, redondearCantidad, type Db } from "./comun";

export interface FilaDevolucionProducto {
  producto: string;
  cantidad: number;
  valor: number;
  sinPrecio: boolean;
}
export interface FilaDevolucionProveedor {
  proveedor: string;
  cantidad: number;
  valor: number;
  sinPrecio: boolean;
  productos: FilaDevolucionProducto[];
}
export interface ReporteDevoluciones {
  dias: number;
  desde: Date;
  clientes: FilaDevolucionProducto[];
  proveedores: FilaDevolucionProveedor[];
  totalCliente: number;
  totalProveedor: number;
  hayCostoIncompleto: boolean;
}

/**
 * Port de generarReporteDevoluciones_ (Reportes.js:1930-2012; hallazgo
 * A-5). DEVOLUCION_CLIENTE/DEVOLUCION_PROVEEDOR quedaban trazables por
 * Operacion, pero sin ningún reporte agregado. A diferencia de Merma/
 * Consumo, ninguno de los dos captura un motivo libre — DEVOLUCION_
 * PROVEEDOR agrupa por el proveedor de la Operacion, DEVOLUCION_CLIENTE
 * solo tiene el producto en sí.
 */
export async function generarReporteDevoluciones(sucursalId: string, diasAtras: number, db: Db = prisma): Promise<ReporteDevoluciones> {
  const dias = diasAtras > 0 ? diasAtras : 30;
  const desde = new Date();
  desde.setUTCDate(desde.getUTCDate() - dias);
  desde.setUTCHours(0, 0, 0, 0);

  const costos = await obtenerCostoActualPorMP(sucursalId, db);
  const movimientos = await db.movimientoStock.findMany({
    where: { proceso: { in: ["DEVOLUCION_CLIENTE", "DEVOLUCION_PROVEEDOR"] }, seccion: { sucursalId }, operacion: { fecha: { gte: desde } } },
    select: { proceso: true, cantidad: true, productoId: true, producto: { select: { nombre: true } }, operacion: { select: { proveedor: { select: { nombre: true } } } } },
  });

  const porProductoCliente = new Map<string, { producto: string; cantidad: number; valor: number; sinPrecio: boolean }>();
  const porProveedor = new Map<string, { cantidad: number; productos: Map<string, { producto: string; cantidad: number; valor: number; sinPrecio: boolean }> }>();

  const acumularProducto = (mapa: Map<string, { producto: string; cantidad: number; valor: number; sinPrecio: boolean }>, productoId: string, productoNombre: string, cantidad: number) => {
    if (!mapa.has(productoId)) mapa.set(productoId, { producto: productoNombre, cantidad: 0, valor: 0, sinPrecio: false });
    const g = mapa.get(productoId)!;
    g.cantidad += cantidad;
    const costo = costos.get(productoId);
    if (costo) g.valor += cantidad * costo.precioPorUnidadStock;
    else g.sinPrecio = true; // no inventar el costo, mismo criterio que generarReportePerdidas
  };

  for (const m of movimientos) {
    const cantidad = Math.abs(Number(m.cantidad));
    if (cantidad <= 0) continue;

    if (m.proceso === "DEVOLUCION_CLIENTE") {
      acumularProducto(porProductoCliente, m.productoId, m.producto.nombre, cantidad);
      continue;
    }

    const proveedor = m.operacion.proveedor?.nombre ?? "(sin proveedor)";
    if (!porProveedor.has(proveedor)) porProveedor.set(proveedor, { cantidad: 0, productos: new Map() });
    const g = porProveedor.get(proveedor)!;
    g.cantidad += cantidad;
    acumularProducto(g.productos, m.productoId, m.producto.nombre, cantidad);
  }

  const listaClientes = Array.from(porProductoCliente.values())
    .map((g) => ({ ...g, cantidad: redondearCantidad(g.cantidad), valor: redondearMoneda(g.valor) }))
    .sort((a, b) => b.valor - a.valor);

  const listaProveedores = Array.from(porProveedor.entries())
    .map(([proveedor, g]) => {
      const productos = Array.from(g.productos.values())
        .map((p) => ({ ...p, cantidad: redondearCantidad(p.cantidad), valor: redondearMoneda(p.valor) }))
        .sort((a, b) => b.valor - a.valor);
      return {
        proveedor,
        cantidad: redondearCantidad(g.cantidad),
        valor: redondearMoneda(productos.reduce((a, p) => a + p.valor, 0)),
        sinPrecio: productos.some((p) => p.sinPrecio),
        productos,
      };
    })
    .sort((a, b) => b.valor - a.valor);

  return {
    dias,
    desde,
    clientes: listaClientes,
    proveedores: listaProveedores,
    totalCliente: redondearMoneda(listaClientes.reduce((a, g) => a + g.valor, 0)),
    totalProveedor: redondearMoneda(listaProveedores.reduce((a, g) => a + g.valor, 0)),
    hayCostoIncompleto: listaClientes.some((g) => g.sinPrecio) || listaProveedores.some((g) => g.sinPrecio),
  };
}
