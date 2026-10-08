import "server-only";
import type { Prisma } from "@prisma/client";

/**
 * Escrituras de las MESAS del salón y de su límite por sucursal (Hito 4 de la pureza, bloque 4.1 — `docs/plan-hito-4-pureza.md` §5; mismo contrato que el resto
 * de `server/persistencia/pos/`: el cliente es el PRIMER parámetro, `data` literal, sin reglas de negocio). Son EXACTAMENTE las escrituras que antes hacía en
 * línea `src/server/actions/pos/mesas.ts`; las llaman los casos de uso de `src/server/actions/pos/casos-de-uso/` (alta de mesa, límite de mesas abiertas), que
 * deciden el cliente: hoy las dos escriben SIN transacción, con la base del contexto (`actor.db`), como antes.
 */

/**
 * Da de alta la mesa `numero` en la sucursal. El número es único por sucursal (`@@unique([sucursalId, numero])`): un número repetido lo rechaza la BASE (P2002)
 * y lo traduce el caso de uso, no una lectura previa, así dos altas simultáneas del mismo número no pueden pasar las dos.
 */
export async function escribirMesaNueva(db: Prisma.TransactionClient, args: { sucursalId: string; numero: number }): Promise<void> {
  await db.mesa.create({ data: { sucursalId: args.sucursalId, numero: args.numero } });
}

/** Fija el cupo de mesas ABIERTAS a la vez de la sucursal (`Sucursal.maxMesasAbiertas`; `null` = sin límite). La auditoría la escribe el caso de uso. */
export async function fijarMaxMesasAbiertas(db: Prisma.TransactionClient, args: { sucursalId: string; maxMesasAbiertas: number | null }): Promise<void> {
  await db.sucursal.update({ where: { id: args.sucursalId }, data: { maxMesasAbiertas: args.maxMesasAbiertas } });
}
