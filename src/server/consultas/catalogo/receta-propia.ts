import "server-only";
import type { PrismaClient } from "@prisma/client";
import { sucursalesDondeElUsuarioPuedeVer } from "@/server/acceso/gate";
import { cargarRecetasPropiasHabilitadas } from "@/server/lecturas/catalogo/recetas-vigentes";
import { obtenerEstadoDeRecetaPropia } from "@/server/lecturas/catalogo/receta-propia";

export { obtenerEstadoDeRecetaPropia };

/**
 * Lecturas del bloque «Receta de esta sucursal» del editor de recetas (ADR-009, R3/R4). Mismo contrato que `consultas/catalogo/recetas.ts`:
 * `server-only`, sin guarda de permiso adentro (la página la hace antes), `db: Db` al final. Lee las DOS series por separado — la propia de la
 * sucursal y la central, nunca la efectiva —, siempre a través del embudo de recetas.
 */

/**
 * Las OTRAS sucursales de la empresa que tienen una receta propia habilitada para el producto Y donde `usuarioId` puede copiar de ahí: las únicas con membresía vigente
 * y «Ver» de `receta_sucursal_copiar` (S-07, O.56: la lista nunca nombra una sucursal que la copia después rechazaría; la acción lo decide de nuevo, esto es solo lo que se ofrece).
 */
export async function listarSucursalesConRecetaPropia(productoId: string, excluirSucursalId: string, usuarioId: string, db: PrismaClient) {
  const candidatas = await db.sucursal.findMany({ where: { id: { not: excluirSucursalId }, activo: true }, orderBy: { nombre: "asc" }, select: { id: true, nombre: true } });
  const visibles = await sucursalesDondeElUsuarioPuedeVer(usuarioId, candidatas.map((s) => s.id), "receta_sucursal_copiar", db);
  const sucursales = candidatas.filter((s) => visibles.has(s.id));
  const conPropia = await cargarRecetasPropiasHabilitadas(db, sucursales.map((s) => s.id), [productoId]);
  return sucursales.filter((s) => conPropia.has(`${s.id}:${productoId}`));
}
