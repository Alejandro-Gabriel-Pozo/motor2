import "server-only";
import type { Db } from "@/lib/db-tipos";

/**
 * Secciones de stock DADAS DE BAJA de una sucursal (id y nombre), para que las pantallas de salida las ofrezcan como ORIGEN (P17, decisión del dueño, 2026-10-11): una sección dada de baja solo admite sacar
 * mercadería (consumir, mermar o transferir) hasta vaciarla, y sin esto la pantalla la esconde y no hay forma de vaciarla. Solo lectura, con `select` (no devuelve la fila entera). Sin guarda de permiso adentro:
 * la página ya la pone (`requierePermisoVer` de la acción del proceso) y pasa la sucursal del contexto. Que una sección dada de baja NO reciba mercadería lo controla el servidor en cada caso de uso, no esta lista.
 */
export async function seccionesDesactivadas(sucursalId: string, db: Db): Promise<{ id: string; nombre: string }[]> {
  return db.seccion.findMany({ where: { sucursalId, activa: false }, select: { id: true, nombre: true }, orderBy: { nombre: "asc" } });
}
