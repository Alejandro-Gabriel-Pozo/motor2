import "server-only";
import { elegirMinimo } from "@/core/stock/public";
import type { Db } from "@/lib/db-tipos";

/**
 * Port de resolverStockMinimo_ (Catalogo.js:1968-1979): gana la fila de la sección exacta si existe; si no, la fila "global" de la sucursal (seccionId null);
 * si no hay ninguna, null — "sin mínimo cargado" y "mínimo cargado en 0" son cosas distintas (0 es un mínimo real: "avisame si esto se termina del todo").
 * La regla de prioridad es pura y vive en `core/stock/stock-minimo.ts` (`elegirMinimo`); acá solo está la lectura (Pureza Fase 3).
 */
export async function resolverStockMinimo(sucursalId: string, productoId: string, seccionId: string | null, db: Db): Promise<number | null> {
  const porSeccion = seccionId ? await db.stockMinimoProducto.findUnique({ where: { productoId_seccionId: { productoId, seccionId } } }) : null;
  const global = porSeccion ? null : await db.stockMinimoProducto.findFirst({ where: { sucursalId, productoId, seccionId: null } });
  return elegirMinimo(porSeccion ? Number(porSeccion.minimo) : null, global ? Number(global.minimo) : null);
}
