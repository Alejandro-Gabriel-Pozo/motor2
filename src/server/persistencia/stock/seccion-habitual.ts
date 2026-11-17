import "server-only";
import type { Prisma } from "@prisma/client";

/**
 * Escrituras de la SECCIÓN HABITUAL de un producto de venta en una sucursal (`SeccionHabitualProducto`; Hito 4 de la pureza, bloque C de la pieza
 * carta/catálogo/stock, paso H4C-20 — `docs/plan-hito-4-pureza.md` §3; mismo contrato que el resto de `server/persistencia/`: el cliente es el PRIMER parámetro,
 * `data` literal, sin reglas de negocio). Son EXACTAMENTE las dos escrituras (la segunda ya no borra: quita con rastro, E-4(2)) que antes hacía en línea `src/server/actions/stock/seccion-habitual.ts`; las llaman sus
 * casos de uso, con la base del contexto y sin transacción (como antes). Una preferencia de sección no es plata: no se audita.
 */

/** Alta o reemplazo de la sección habitual del producto en la sucursal (una fila por sucursal × producto). */
export async function guardarSeccionHabitual(db: Prisma.TransactionClient, args: { sucursalId: string; productoId: string; seccionId: string }): Promise<void> {
  await db.seccionHabitualProducto.upsert({
    where: { sucursalId_productoId: { sucursalId: args.sucursalId, productoId: args.productoId } },
    update: { seccionId: args.seccionId, quitadoEn: null, quitadoPorId: null },
    create: { sucursalId: args.sucursalId, productoId: args.productoId, seccionId: args.seccionId },
  });
}

/**
 * Quita la fila SIN borrarla (E-4(2)): el producto vuelve a salir de donde haya stock (por vencimiento) y la fila queda marcada con quién y cuándo. Devuelve cuántas filas quitó (0 = ya estaba quitada o
 * no existe: de dos pedidos simultáneos gana uno solo).
 */
export async function quitarSeccionHabitual(db: Prisma.TransactionClient, args: { id: string; quitadoPorId: string; quitadoEn: Date }): Promise<number> {
  const { count } = await db.seccionHabitualProducto.updateMany({ where: { id: args.id, quitadoEn: null }, data: { quitadoEn: args.quitadoEn, quitadoPorId: args.quitadoPorId } });
  return count;
}
