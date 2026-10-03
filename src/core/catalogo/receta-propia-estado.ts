import type { Db } from "@/lib/db-tipos";
import { ALCANCE_CENTRAL, alcanceDeSucursal, cargarHistorialDeVersiones, cargarRecetaVigente } from "./recetas-vigentes";
import { INCLUDE_RECETA_COMPLETA } from "./receta-a-input";

/**
 * Estado de la receta propia de una sucursal (ADR-009, R3/R4). Vive en `core/catalogo` y no en `consultas/` porque lo leen tanto la pantalla del
 * editor como las acciones de la receta propia (que no pueden importar de `consultas/`). Lee las DOS series por separado, siempre por el embudo.
 */
/** La receta propia de `sucursalId` para el producto (la serie propia, aunque hoy esté deshabilitada) y cómo está respecto de la central. */
export async function obtenerEstadoDeRecetaPropia(productoId: string, sucursalId: string, db: Db) {
  const [fila, historial, centralVigente] = await Promise.all([
    db.recetaSucursal.findUnique({ where: { sucursalId_productoId: { sucursalId, productoId } }, select: { habilitada: true } }),
    cargarHistorialDeVersiones(db, alcanceDeSucursal(sucursalId), productoId, INCLUDE_RECETA_COMPLETA),
    cargarRecetaVigente(db, ALCANCE_CENTRAL, productoId, { select: { id: true, version: true } }),
  ]);
  const habilitada = fila?.habilitada ?? false;
  const propia = historial[0] ?? null;
  // «La central cambió»: hay una central vigente distinta de aquella en la que se basó la propia. Solo se avisa; nunca se aplica nada solo.
  const centralCambio = habilitada && propia !== null && propia.basadaEnVersionId !== null && centralVigente !== null && propia.basadaEnVersionId !== centralVigente.id;
  return { habilitada, propia, versionesPropias: historial.length, centralVigente, centralCambio };
}
