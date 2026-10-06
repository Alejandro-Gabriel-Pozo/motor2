import "server-only";
import type { Db } from "@/lib/db-tipos";
import { cargarRecetasPropiasHabilitadas } from "@/core/catalogo/public";
import { obtenerEstadoDeRecetaPropia } from "@/core/catalogo/public-servidor";

export { obtenerEstadoDeRecetaPropia };

/**
 * Lecturas del bloque «Receta de esta sucursal» del editor de recetas (ADR-009, R3/R4). Mismo contrato que `consultas/catalogo/recetas.ts`:
 * `server-only`, sin guarda de permiso adentro (la página la hace antes), `db: Db` al final. Lee las DOS series por separado — la propia de la
 * sucursal y la central, nunca la efectiva —, siempre a través del embudo de recetas.
 */

/** Las OTRAS sucursales de la empresa que tienen una receta propia habilitada para el producto: de ahí se puede copiar. */
export async function listarSucursalesConRecetaPropia(productoId: string, excluirSucursalId: string, db: Db) {
  const sucursales = await db.sucursal.findMany({ where: { id: { not: excluirSucursalId }, activo: true }, orderBy: { nombre: "asc" }, select: { id: true, nombre: true } });
  const conPropia = await cargarRecetasPropiasHabilitadas(db, sucursales.map((s) => s.id), [productoId]);
  return sucursales.filter((s) => conPropia.has(`${s.id}:${productoId}`));
}
