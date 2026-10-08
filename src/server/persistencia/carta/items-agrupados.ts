import "server-only";
import type { Prisma } from "@prisma/client";

/**
 * Escrituras de los ÍTEMS AGRUPADOS de la carta y sus opciones (`ItemAgrupadoCarta` y `OpcionItemAgrupadoCarta`; Hito 5, bloque D, `docs/plan-hito-5-pureza.md` §6.1;
 * mismo contrato que el resto de `server/persistencia/`: el cliente es el PRIMER parámetro, `data` literal, sin reglas de negocio). Son EXACTAMENTE las escrituras
 * que antes hacía en línea `src/server/actions/carta/items-agrupados.ts`; las llaman solo los casos de uso de `src/server/actions/carta/casos-de-uso/`, con la base
 * del contexto y sin transacción, como antes (un ítem agrupado no es plata: sin auditoría).
 */

/** Apaga o prende un ítem agrupado (nunca se borra: apagado deja de salir en la carta, y sus opciones tampoco salen sueltas, D3). */
export async function fijarActivoDeItemAgrupadoCarta(db: Prisma.TransactionClient, args: { id: string; activo: boolean }): Promise<void> {
  await db.itemAgrupadoCarta.update({ where: { id: args.id }, data: { activo: args.activo } });
}

/** Cambia el orden de una opción de un ítem agrupado. */
export async function cambiarOrdenDeOpcionDeItemAgrupado(db: Prisma.TransactionClient, args: { id: string; orden: number }): Promise<void> {
  await db.opcionItemAgrupadoCarta.update({ where: { id: args.id }, data: { orden: args.orden } });
}

/** Saca un producto de su ítem agrupado: se borra solo la fila de referencia (el producto y su `ContenidoCartaProducto` no se tocan, D3). */
export async function quitarOpcionDeItemAgrupado(db: Prisma.TransactionClient, args: { id: string }): Promise<void> {
  await db.opcionItemAgrupadoCarta.deleteMany({ where: { id: args.id } });
}
