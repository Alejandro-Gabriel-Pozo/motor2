import "server-only";
import type { Prisma } from "@prisma/client";

/**
 * Escrituras del STOCK MÍNIMO por sucursal × producto (`StockMinimoProducto`: una fila GLOBAL de la sucursal —`seccionId` null— y, si hace falta, una por sección;
 * Hito 4 de la pureza, bloque C de la pieza carta/catálogo/stock, paso H4C-21 — `docs/plan-hito-4-pureza.md` §3; mismo contrato que el resto de
 * `server/persistencia/`: el cliente es el PRIMER parámetro, `data` literal, sin reglas de negocio). Son EXACTAMENTE las escrituras que antes hacía en línea
 * `src/server/actions/stock/stock-minimo.ts`; las llaman los casos de uso `set-stock-minimo-producto.ts` y `eliminar-stock-minimo.ts`. Las dos de «fijar» devuelven
 * el id de la fila que quedó y el mínimo que tenía ANTES (`null` si no había fila): es lo que necesita la auditoría del cambio (4.4). Para eso la de una sección
 * lee la fila por su clave única antes del upsert (la global ya la leía para elegir entre cambiar y crear).
 */

/** El id de la fila que quedó escrita y el mínimo que tenía antes (`null` si la fila no existía). */
export interface MinimoEscrito {
  id: string;
  anterior: number | null;
}

/** Alta o cambio del mínimo de un producto en UNA sección (la clave única `(productoId, seccionId)` lo vuelve un upsert). */
export async function guardarMinimoDeSeccion(
  db: Prisma.TransactionClient,
  args: { sucursalId: string; productoId: string; seccionId: string; minimo: number },
): Promise<MinimoEscrito> {
  const previa = await db.stockMinimoProducto.findUnique({ where: { productoId_seccionId: { productoId: args.productoId, seccionId: args.seccionId } }, select: { minimo: true } });
  const fila = await db.stockMinimoProducto.upsert({
    where: { productoId_seccionId: { productoId: args.productoId, seccionId: args.seccionId } },
    update: { minimo: args.minimo },
    create: { sucursalId: args.sucursalId, productoId: args.productoId, seccionId: args.seccionId, minimo: args.minimo },
  });
  return { id: fila.id, anterior: previa ? Number(previa.minimo) : null };
}

/**
 * Alta o cambio del mínimo GLOBAL de un producto en la sucursal (`seccionId` null). El índice único parcial `(sucursalId, productoId) WHERE seccionId IS NULL` (ver
 * migración manual, README) es el árbitro final; acá se busca a mano porque Prisma no puede expresar un `where` de upsert sobre un índice parcial, solo sobre una
 * `@@unique` declarada en el schema: si existe se cambia, si no se crea (las MISMAS consultas que hacía la acción).
 */
export async function guardarMinimoGlobal(db: Prisma.TransactionClient, args: { sucursalId: string; productoId: string; minimo: number }): Promise<MinimoEscrito> {
  const existente = await db.stockMinimoProducto.findFirst({ where: { sucursalId: args.sucursalId, productoId: args.productoId, seccionId: null } });
  if (existente) {
    await db.stockMinimoProducto.update({ where: { id: existente.id }, data: { minimo: args.minimo } });
    return { id: existente.id, anterior: Number(existente.minimo) };
  }
  const creada = await db.stockMinimoProducto.create({ data: { sucursalId: args.sucursalId, productoId: args.productoId, minimo: args.minimo } });
  return { id: creada.id, anterior: null };
}

/** Borra la fila de stock mínimo. */
export async function borrarStockMinimo(db: Prisma.TransactionClient, args: { id: string }): Promise<void> {
  await db.stockMinimoProducto.delete({ where: { id: args.id } });
}
