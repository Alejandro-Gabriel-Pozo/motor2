import "server-only";
import type { Prisma } from "@prisma/client";

/**
 * Escrituras de la AGENDA DE CONTEO FÍSICO por sucursal × producto (`FrecuenciaConteoProducto`; Hito 4 de la pureza, bloque C de la pieza carta/catálogo/stock,
 * paso H4C-19 — `docs/plan-hito-4-pureza.md` §3; mismo contrato que el resto de `server/persistencia/`: el cliente es el PRIMER parámetro, `data` literal, sin
 * reglas de negocio). Son EXACTAMENTE las dos escrituras que antes hacía en línea `src/server/actions/stock/frecuencia-conteo.ts`; las llaman sus casos de uso, con
 * la base del contexto y sin transacción (como antes). Una frecuencia es un número entero de días: no es plata ni cambia el significado de una cantidad.
 */

/** Alta o reemplazo de la frecuencia del producto en la sucursal (una fila por sucursal × producto; el 0 se guarda, no se borra). */
export async function guardarFrecuenciaConteo(db: Prisma.TransactionClient, args: { sucursalId: string; productoId: string; frecuenciaDias: number }): Promise<void> {
  await db.frecuenciaConteoProducto.upsert({
    where: { sucursalId_productoId: { sucursalId: args.sucursalId, productoId: args.productoId } },
    update: { frecuenciaDias: args.frecuenciaDias },
    create: { sucursalId: args.sucursalId, productoId: args.productoId, frecuenciaDias: args.frecuenciaDias },
  });
}

/** Borra la fila de la agenda. */
export async function borrarFrecuenciaConteo(db: Prisma.TransactionClient, args: { id: string }): Promise<void> {
  await db.frecuenciaConteoProducto.delete({ where: { id: args.id } });
}
