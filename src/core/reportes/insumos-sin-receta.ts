import { prisma } from "@/lib/db";
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
 * algún PV (aunque sea 1:1): una MP activa que no aparece en NINGUNA
 * receta vigente es, por definición, un insumo que se compra pero nada lo
 * consume/revende todavía.
 */
export async function generarReporteInsumosSinRecetaVinculada(db: Db = prisma): Promise<FilaInsumoSinReceta[]> {
  const productos = await construirMapaProductos(undefined, db); // catálogo central: no depende de sucursal para este reporte
  const { mpsEnRecetas } = await construirIndiceRecetas(db);
  const conProveedor = new Set((await db.proveedorPorProducto.findMany({ select: { productoId: true }, distinct: ["productoId"] })).map((p) => p.productoId));

  return Array.from(productos.values())
    .filter((info) => info.tipo === "MP" && info.activo && !mpsEnRecetas.has(info.id))
    .map((info) => ({ productoId: info.id, producto: info.nombre, codigo: info.codigo, insumoNombre: info.insumoNombre, tieneProveedor: conProveedor.has(info.id) }))
    .sort((a, b) => a.producto.localeCompare(b.producto));
}
