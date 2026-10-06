import { construirIndiceRecetas, construirMapaProductos, type Db } from "./comun";

export interface FilaInsumoSinReceta {
  productoId: string;
  producto: string;
  codigo: string;
  insumoNombre: string | null;
  tieneProveedor: boolean;
}

/**
 * Port de generarReporteInsumosSinRecetaVinculada_ (Reportes.js:826-842).
 * Auditoría en vivo, NO un ledger persistido — con COMPRA+VENTA eliminado,
 * el único camino para que una MP se pueda vender es estar en la receta de
 * algún PV (aunque sea 1:1): una MP disponible EN ESTA SUCURSAL que no
 * aparece en NINGUNA receta vigente es, por definición, un insumo que se
 * compra pero nada lo consume/revende todavía acá.
 */
export async function generarReporteInsumosSinRecetaVinculada(sucursalId: string, db: Db): Promise<FilaInsumoSinReceta[]> {
  const productos = await construirMapaProductos(sucursalId, db);
  const { mpsEnRecetas } = await construirIndiceRecetas(db);
  const conProveedor = new Set((await db.proveedorPorProducto.findMany({ select: { productoId: true }, distinct: ["productoId"] })).map((p) => p.productoId));

  return Array.from(productos.values())
    .filter((info) => info.tipo === "MP" && info.disponible && !mpsEnRecetas.has(info.id))
    .map((info) => ({ productoId: info.id, producto: info.nombre, codigo: info.codigo, insumoNombre: info.insumoNombre, tieneProveedor: conProveedor.has(info.id) }))
    .sort((a, b) => a.producto.localeCompare(b.producto));
}
