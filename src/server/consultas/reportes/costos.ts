import "server-only";
import type { FilaCostoProducto, FilaImpactoInsumo, ObjetivosDeMargen } from "@/core/reportes/public";
import { calcularCostosYMargenes, calcularImpactoInsumos } from "@/server/lecturas/reportes/costos";
import type { Db } from "@/lib/db-tipos";

/**
 * El reporte «Costos y márgenes» de la pantalla: el costo y el margen de cada plato y qué insumos mueven más el costo total. Compone las dos lecturas (`calcularCostosYMargenes`, que la
 * venta también usa dentro de su transacción, y `calcularImpactoInsumos`) para que la pantalla pida UNA consulta y no importe `server/lecturas` (regla `paginas-solo-consultas`, ADR-026).
 * Las dos lecturas corren en paralelo, como antes. Sin guarda de permiso adentro: la página la pone antes.
 */
export async function cargarCostosYMargenes(sucursalId: string, db: Db, objetivos: ObjetivosDeMargen): Promise<{ productos: FilaCostoProducto[]; insumos: FilaImpactoInsumo[] }> {
  const [productos, insumos] = await Promise.all([calcularCostosYMargenes(sucursalId, db, undefined, undefined, objetivos), calcularImpactoInsumos(sucursalId, db)]);
  return { productos, insumos };
}
