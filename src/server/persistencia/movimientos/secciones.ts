import "server-only";
import type { Prisma } from "@prisma/client";

/**
 * Escrituras de las SECCIONES de stock de una sucursal (`Seccion`; Hito 4 de la pureza, bloque C de la pieza carta/catálogo/stock, paso H4C-18 —
 * `docs/plan-hito-4-pureza.md` §3; mismo contrato que el resto de `server/persistencia/`: el cliente es el PRIMER parámetro, `data` literal, sin reglas de
 * negocio). Son EXACTAMENTE las cuatro escrituras que antes hacía en línea `src/server/actions/movimientos/secciones.ts`; las llaman sus casos de uso, con la base
 * del contexto y sin transacción (como antes). Una sección nunca se borra: el Kardex ya escrito la referencia por FK.
 */

/** Crea la sección en esa sucursal. Devuelve el id y el nombre guardados. */
export async function crearSeccionNueva(db: Prisma.TransactionClient, args: { sucursalId: string; nombre: string }): Promise<{ id: string; nombre: string }> {
  const creada = await db.seccion.create({ data: { sucursalId: args.sucursalId, nombre: args.nombre } });
  return { id: creada.id, nombre: creada.nombre };
}

/** Le pone el nombre nuevo a la sección. */
export async function fijarNombreDeSeccion(db: Prisma.TransactionClient, args: { id: string; nombre: string }): Promise<void> {
  await db.seccion.update({ where: { id: args.id }, data: { nombre: args.nombre } });
}

/** Activa o desactiva la sección (deja de ofrecerse en cargas nuevas). */
export async function fijarActivaDeSeccion(db: Prisma.TransactionClient, args: { id: string; activa: boolean }): Promise<void> {
  await db.seccion.update({ where: { id: args.id }, data: { activa: args.activa } });
}

/** Si la sección sirve de respaldo automático al cerrar una cuenta del salón (`Seccion.sirveDeRespaldoEnVentas`). */
export async function fijarRespaldoDeSeccion(db: Prisma.TransactionClient, args: { id: string; sirveDeRespaldoEnVentas: boolean }): Promise<void> {
  await db.seccion.update({ where: { id: args.id }, data: { sirveDeRespaldoEnVentas: args.sirveDeRespaldoEnVentas } });
}
