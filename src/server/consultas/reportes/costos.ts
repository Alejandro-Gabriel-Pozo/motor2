import "server-only";
import type { FilaCostoProducto, FilaImpactoInsumo, ObjetivosDeMargen } from "@/core/reportes/public";
import { calcularCostosYMargenesEImpactoInsumos } from "@/server/lecturas/reportes/costos";
import type { Db } from "@/lib/db-tipos";

/**
 * El reporte «Costos y márgenes» de la pantalla: el costo y el margen de cada plato y qué insumos mueven más el costo total. Compone las dos lecturas (`calcularCostosYMargenes`, que la
 * venta también usa dentro de su transacción, y `calcularImpactoInsumos`) para que la pantalla pida UNA consulta y no importe `server/lecturas` (regla `paginas-solo-consultas`, ADR-026).
 * Las dos mitades comparten UNA carga del catálogo, las recetas y el costo de reposición (O.39: antes cada una leía todo por su cuenta, 16 consultas en vez
 * de 8; ver `calcularCostosYMargenesEImpactoInsumos`). Sin guarda de permiso adentro: la página la pone antes.
 */
export async function cargarCostosYMargenes(sucursalId: string, db: Db, objetivos: ObjetivosDeMargen): Promise<{ productos: FilaCostoProducto[]; insumos: FilaImpactoInsumo[] }> {
  return calcularCostosYMargenesEImpactoInsumos(sucursalId, db, objetivos);
}
