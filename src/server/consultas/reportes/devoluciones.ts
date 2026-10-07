import "server-only";
import { redondearMoneda } from "@/core/moneda";
import { obtenerCostoActualPorMP } from "@/server/lecturas/reportes/comun";
import type { Db } from "@/lib/db-tipos";
import { redondearCantidad, resolverAccionSinCostoReposicion } from "@/core/reportes/public";
import { ZONA_UTC, inicioDelDiaDe } from "@/core/tiempo/zona-horaria";
import type { FilaDevolucionProducto, ReporteDevoluciones, AccProducto } from "@/core/reportes/public";

/**
 * Port de generarReporteDevoluciones_ (Reportes.js:1930-2012; hallazgo
 * A-5). DEVOLUCION_CLIENTE/DEVOLUCION_PROVEEDOR quedaban trazables por
 * Operacion, pero sin ningún reporte agregado. A diferencia de Merma/
 * Consumo, ninguno de los dos captura un motivo libre — DEVOLUCION_
 * PROVEEDOR agrupa por el proveedor de la Operacion, DEVOLUCION_CLIENTE
 * solo tiene el producto en sí.
 *
 * `accionFaltante` (docs/comparativa-ux-erpnext-dolibarr.md §7.1): cuando
 * `sinPrecio`, cada fila dice qué hacer y dónde en vez de solo avisar que
 * falta un dato — mismo criterio "Se produce" que `resolverAccionFaltante`
 * (Costos) y `generarReporteHuecosCatalogo` (§8.7).
 */
export async function generarReporteDevoluciones(sucursalId: string, diasAtras: number, db: Db): Promise<ReporteDevoluciones> {
  const dias = diasAtras > 0 ? diasAtras : 30;
  const haceNDias = new Date();
  haceNDias.setUTCDate(haceNDias.getUTCDate() - dias);
  const desde = inicioDelDiaDe(haceNDias, ZONA_UTC);

  const costos = await obtenerCostoActualPorMP(sucursalId, db);
  const movimientos = await db.movimientoStock.findMany({
    where: { proceso: { in: ["DEVOLUCION_CLIENTE", "DEVOLUCION_PROVEEDOR"] }, seccion: { sucursalId }, operacion: { fecha: { gte: desde } } },
    select: {
      proceso: true,
      cantidad: true,
      productoId: true,
      producto: { select: { nombre: true, seProduce: true } },
      operacion: { select: { proveedor: { select: { nombre: true } } } },
    },
  });

  const porProductoCliente = new Map<string, AccProducto>();
  const porProveedor = new Map<string, { cantidad: number; productos: Map<string, AccProducto> }>();

  const acumularProducto = (mapa: Map<string, AccProducto>, productoId: string, productoNombre: string, seProduce: boolean, cantidad: number) => {
    if (!mapa.has(productoId)) mapa.set(productoId, { producto: productoNombre, seProduce, cantidad: 0, valor: 0, sinPrecio: false });
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
      acumularProducto(porProductoCliente, m.productoId, m.producto.nombre, m.producto.seProduce, cantidad);
      continue;
    }

    const proveedor = m.operacion.proveedor?.nombre ?? "(sin proveedor)";
    if (!porProveedor.has(proveedor)) porProveedor.set(proveedor, { cantidad: 0, productos: new Map() });
    const g = porProveedor.get(proveedor)!;
    g.cantidad += cantidad;
    acumularProducto(g.productos, m.productoId, m.producto.nombre, m.producto.seProduce, cantidad);
  }

  const aListaProductos = (mapa: Map<string, AccProducto>): FilaDevolucionProducto[] =>
    Array.from(mapa.entries())
      .map(([productoId, g]) => ({
        productoId,
        producto: g.producto,
        cantidad: redondearCantidad(g.cantidad),
        valor: redondearMoneda(g.valor),
        sinPrecio: g.sinPrecio,
        accionFaltante: g.sinPrecio ? resolverAccionSinCostoReposicion(productoId, g.seProduce) : null,
      }))
      .sort((a, b) => b.valor - a.valor);

  const listaClientes = aListaProductos(porProductoCliente);

  const listaProveedores = Array.from(porProveedor.entries())
    .map(([proveedor, g]) => {
      const productos = aListaProductos(g.productos);
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