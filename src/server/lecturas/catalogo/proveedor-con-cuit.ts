import "server-only";
import type { Db } from "@/lib/db-tipos";

/**
 * El nombre del OTRO proveedor de la empresa que ya tiene ese CUIT (el RLS acota a la empresa activa), o `null` (Hito 4 de la pureza, paso H4C-14 —
 * `docs/plan-hito-4-pureza.md` §3). Era `proveedorConCuit` de `src/server/actions/catalogo/proveedores.ts`, movida TAL CUAL (misma consulta): la usan los casos de
 * uso del alta y de la edición de un proveedor, antes de escribir y, si el índice único `(empresaId, cuit)` frena una carrera, otra vez para nombrar al otro. Sin
 * CUIT no lee nada. `excluirId` es el proveedor que se está editando (no se compara contra sí mismo).
 */
export async function proveedorConCuit(db: Db, cuit: string | null, excluirId?: string): Promise<string | null> {
  if (!cuit) return null;
  return (await db.proveedor.findFirst({ where: { cuit, ...(excluirId ? { id: { not: excluirId } } : {}) }, select: { nombre: true } }))?.nombre ?? null;
}
