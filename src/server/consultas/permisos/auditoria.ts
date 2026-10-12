import "server-only";
import type { PrismaClient } from "@prisma/client";
import { sucursalesDondeElUsuarioPuedeVer } from "@/server/acceso/gate";
import type { CambioAuditable } from "@/core/permisos/auditoria";
import type { Db } from "@/lib/db-tipos";

/**
 * Las LECTURAS de la auditoría (Pureza Fase 3, tramo B): el registro de cambios y de qué sucursales puede ver el usuario. Salieron de `core/permisos/auditoria.ts`, que
 * conserva lo puro (las entidades auditables, la descripción para mostrar) y la ESCRITURA del cambio (`registrarCambioAuditado`, de la Fase 4). Sin guarda de permiso
 * adentro: la página la pone antes (`ver_auditoria`, y `ver_auditoria_empresa` para las filas de la empresa entera).
 */

const TAMANO_PAGINA_AUDITORIA = 50;

export interface FiltroAuditoria {
  entidad?: CambioAuditable["entidad"];
  cursor?: string;
  /**
   * Obligatorio a propósito: las sucursales cuyas filas se pueden mostrar. Quien llama lo arma con
   * `sucursalesVisiblesDeAuditoria`; nunca "todas por omisión". M.3-A5: el `db` con que se llama a `listarRegistrosAuditoria` es el del contexto ampliado por
   * `lecturaEnSucursalesVisibles(ctx, "ver_auditoria")` (lo exige `test/arquitectura/lectores-de-varias-sucursales.test.ts`): la base solo ve el registro de esas sucursales.
   */
  sucursalIds: readonly string[];
  /**
   * Obligatorio a propósito: si se muestran también las filas SIN sucursal (cambios de la empresa entera: roles, receta central).
   * Esas no pertenecen a ninguna sucursal, así que `ver_auditoria` (que es por sucursal) no las cubre: las ve quien tiene
   * `ver_auditoria_empresa` (acción de piso gerente: el gerente de la empresa).
   */
  incluirFilasDeEmpresa: boolean;
}

/** De las sucursales del usuario, en cuáles su rol tiene «Ver» sobre `ver_auditoria` — el gate de la página mira solo la activa. */
export async function sucursalesVisiblesDeAuditoria(usuarioId: string, sucursalIds: readonly string[], db: PrismaClient): Promise<string[]> {
  const visibles = await sucursalesDondeElUsuarioPuedeVer(usuarioId, sucursalIds, "ver_auditoria", db);
  return sucursalIds.filter((id) => visibles.has(id));
}

/** Más reciente primero, paginado por cursor — mismo patrón que el resto de los listados largos del proyecto (ver obtenerHistorialConteosFisicos). */
export async function listarRegistrosAuditoria(filtro: FiltroAuditoria, db: Db) {
  const filas = await db.registroAuditoria.findMany({
    where: {
      ...(filtro.entidad ? { entidad: filtro.entidad } : {}),
      OR: [...(filtro.incluirFilasDeEmpresa ? [{ sucursalId: null }] : []), { sucursalId: { in: [...filtro.sucursalIds] } }],
    },
    include: { actor: { select: { email: true, name: true } }, sucursal: { select: { nombre: true } } },
  // `id` desempata: `creadoEn` se repite (filas de una misma transacción) y, con cursor, un orden no total salta filas.
    orderBy: [{ creadoEn: "desc" }, { id: "desc" }],
    take: TAMANO_PAGINA_AUDITORIA + 1,
    ...(filtro.cursor ? { cursor: { id: filtro.cursor }, skip: 1 } : {}),
  });

  const hayMas = filas.length > TAMANO_PAGINA_AUDITORIA;
  const items = hayMas ? filas.slice(0, TAMANO_PAGINA_AUDITORIA) : filas;
  return { items, nextCursor: hayMas ? items[items.length - 1]!.id : null };
}
