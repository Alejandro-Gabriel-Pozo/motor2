import "server-only";
import type { Prisma } from "@prisma/client";
import { NUMERO_DEL_MOSTRADOR } from "@/core/pos/public";

/**
 * Escrituras de las MESAS del salón (Hito 4 de la pureza, bloque 4.1 — `docs/plan-hito-4-pureza.md` §5; mismo contrato que el resto
 * de `server/persistencia/pos/`: el cliente es el PRIMER parámetro, `data` literal, sin reglas de negocio). Son EXACTAMENTE las escrituras que antes hacía en
 * línea `src/server/actions/pos/mesas.ts`; las llaman los casos de uso de `src/server/actions/pos/casos-de-uso/` (alta de mesa, habilitar el mostrador), que
 * deciden el cliente: el alta escribe SIN transacción, con la base del contexto (`actor.db`), como antes.
 */

/**
 * Da de alta la mesa `numero` en la sucursal. El número es único por sucursal (`@@unique([sucursalId, numero])`): un número repetido lo rechaza la BASE (P2002)
 * y lo traduce el caso de uso, no una lectura previa, así dos altas simultáneas del mismo número no pueden pasar las dos.
 */
export async function escribirMesaNueva(db: Prisma.TransactionClient, args: { sucursalId: string; numero: number }): Promise<void> {
  await db.mesa.create({ data: { sucursalId: args.sucursalId, numero: args.numero } });
}

/**
 * Da de alta el puesto MOSTRADOR de la sucursal (ADR-039): la mesa de número 0 y tipo `MOSTRADOR`. A lo sumo uno por sucursal: lo imponen `@@unique([sucursalId, numero])` y `Mesa_numero_segun_tipo_chk`
 * (un segundo choca con P2002). Devuelve el id del puesto creado. La auditoría la escribe el caso de uso.
 */
export async function escribirMostradorNuevo(db: Prisma.TransactionClient, args: { sucursalId: string }): Promise<string> {
  const creada = await db.mesa.create({ data: { sucursalId: args.sucursalId, numero: NUMERO_DEL_MOSTRADOR, tipo: "MOSTRADOR" }, select: { id: true } });
  return creada.id;
}
