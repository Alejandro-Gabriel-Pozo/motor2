import "server-only";
import { armarSaludPorProducto, type FilaSaludProducto } from "@/core/reportes/public";
import { generarReporteDiferenciasAjustes } from "@/server/consultas/reportes/diferencias-ajustes";
import { generarReporteInsumosSinRecetaVinculada } from "@/server/consultas/reportes/insumos-sin-receta";
import { calcularAlertasStock } from "@/server/consultas/stock/alertas";
import { calcularStockConsolidado } from "@/server/consultas/stock/consolidado";
import { construirMapaProductos } from "@/server/lecturas/reportes/comun";
import type { Db } from "@/lib/db-tipos";

/**
 * Salud por producto (port de generarReporteSaludPorProducto_, Reportes.js:918-979; hallazgo M-3): el cruce de lo que YA calculan Stock Consolidado, Alertas,
 * Diferencias de Ajuste e Insumos sin receta. Esta consulta junta los cuatro; el cruce es puro y vive en `core/reportes/salud-por-producto.ts` (Pureza Fase 3).
 * Sin guarda de permiso adentro: la página la pone antes.
 */
export async function generarReporteSaludPorProducto(sucursalId: string, db: Db): Promise<FilaSaludProducto[]> {
  // Lo que los cuatro leían cada uno por su cuenta se lee UNA vez y se les pasa (O.39 de docs/pureza-integracion.md): el mapa de productos de la sucursal
  // (Diferencias e Insumos sin receta armaban el mismo, 5 consultas cada uno; Alertas toma de él los productos que nombra) y las secciones de la sucursal
  // (Stock Consolidado y Alertas hacían la misma lectura). Cada reporte sigue calculando lo suyo con sus propias funciones.
  const [productos, secciones] = await Promise.all([construirMapaProductos(sucursalId, db), db.seccion.findMany({ where: { sucursalId } })]);
  const [consolidado, alertas, diferencias, sinReceta] = await Promise.all([
    calcularStockConsolidado(sucursalId, db, secciones),
    calcularAlertasStock(sucursalId, db, { productos: Array.from(productos.values()), secciones }),
    generarReporteDiferenciasAjustes(sucursalId, db, undefined, productos),
    generarReporteInsumosSinRecetaVinculada(sucursalId, db, productos),
  ]);
  return armarSaludPorProducto(consolidado, alertas, diferencias, sinReceta);
}
