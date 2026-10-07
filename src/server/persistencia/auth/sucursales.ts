import "server-only";
import type { Prisma } from "@prisma/client";

/**
 * Persistencia de las SUCURSALES (Hito 3, Fase I, I.4 de `docs/plan-hito-3-pureza.md`). Son EXACTAMENTE las escrituras que las Server Actions de
 * `src/server/actions/auth/sucursales.ts` hacían en línea, mudadas tal cual. Sin reglas de negocio ni auditoría: qué sucursal, con qué nombre y si se puede lo
 * decide cada caso de uso (`server/actions/auth/casos-de-uso/`), que además audita en la misma transacción. El cliente es SIEMPRE el primer parámetro, la
 * transacción del caso de uso (nunca `db = prisma` por defecto).
 */

/** Da de alta la sucursal en la empresa. Devuelve su id. */
export async function crearSucursal(tx: Prisma.TransactionClient, entrada: { nombre: string; empresaId: string }): Promise<{ id: string }> {
  return tx.sucursal.create({ data: { nombre: entrada.nombre, empresaId: entrada.empresaId } });
}

/** Activa o desactiva una sucursal. */
export async function cambiarActivoDeSucursal(tx: Prisma.TransactionClient, entrada: { sucursalId: string; activo: boolean }): Promise<void> {
  await tx.sucursal.update({ where: { id: entrada.sucursalId }, data: { activo: entrada.activo } });
}

/**
 * La disponibilidad inicial de una sucursal recién creada: los productos que el caso de uso ya resolvió (los «universales», decisión 4 del dueño,
 * docs/plan-disponibilidad-por-sucursal-2026-09-23.md §10), disponibles en ella. Escribir `DisponibilidadProducto` cambia qué se puede vender y mover en la
 * sucursal: `escrituras-auditadas` exige que TODO llamador audite (la cadena caso de uso → persistencia).
 */
export async function sembrarDisponibilidadDeSucursalNueva(
  tx: Prisma.TransactionClient,
  entrada: { sucursalId: string; empresaId: string; productoIds: readonly string[] },
): Promise<void> {
  const { sucursalId, empresaId, productoIds } = entrada;
  await tx.disponibilidadProducto.createMany({ data: productoIds.map((productoId) => ({ sucursalId, empresaId, productoId, disponible: true })) });
}
