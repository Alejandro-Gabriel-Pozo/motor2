import { construirIndiceRecetas, construirMapaProductos } from "@/server/lecturas/reportes/comun";
import { cargarProductosConProveedor } from "@/server/lecturas/catalogo/ofertas-de-proveedor";
import type { Db } from "@/lib/db-tipos";
import type { FilaInsumoSinReceta } from "@/core/reportes/public";

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
  const conProveedor = await cargarProductosConProveedor(db); // del Kardex vigente: una compra anulada no cuenta

  return Array.from(productos.values())
    .filter((info) => info.tipo === "MP" && info.disponible && !mpsEnRecetas.has(info.id))
    .map((info) => ({ productoId: info.id, producto: info.nombre, codigo: info.codigo, insumoNombre: info.insumoNombre, tieneProveedor: conProveedor.has(info.id) }))
    .sort((a, b) => a.producto.localeCompare(b.producto));
}