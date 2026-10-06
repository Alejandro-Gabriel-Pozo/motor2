import "server-only";
import { armarSaludPorProducto, type FilaSaludProducto } from "@/core/reportes/public";
import { generarReporteDiferenciasAjustes, generarReporteInsumosSinRecetaVinculada } from "@/core/reportes/public-servidor";
import { calcularAlertasStock } from "@/server/consultas/stock/alertas";
import { calcularStockConsolidado } from "@/server/consultas/stock/consolidado";
import type { Db } from "@/lib/db-tipos";

/**
 * Salud por producto (port de generarReporteSaludPorProducto_, Reportes.js:918-979; hallazgo M-3): el cruce de lo que YA calculan Stock Consolidado, Alertas,
 * Diferencias de Ajuste e Insumos sin receta. Esta consulta junta los cuatro; el cruce es puro y vive en `core/reportes/salud-por-producto.ts` (Pureza Fase 3).
 * Sin guarda de permiso adentro: la página la pone antes.
 */
export async function generarReporteSaludPorProducto(sucursalId: string, db: Db): Promise<FilaSaludProducto[]> {
  const [consolidado, alertas, diferencias, sinReceta] = await Promise.all([
    calcularStockConsolidado(sucursalId, db),
    calcularAlertasStock(sucursalId, db),
    generarReporteDiferenciasAjustes(sucursalId, db),
    generarReporteInsumosSinRecetaVinculada(sucursalId, db),
  ]);
  return armarSaludPorProducto(consolidado, alertas, diferencias, sinReceta);
}
