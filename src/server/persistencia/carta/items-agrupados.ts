import "server-only";
import type { Prisma } from "@prisma/client";

/**
 * Escrituras de los ÍTEMS AGRUPADOS de la carta y sus opciones (`ItemAgrupadoCarta` y `OpcionItemAgrupadoCarta`; Hito 5, bloque D, `docs/plan-hito-5-pureza.md` §6.1;
 * mismo contrato que el resto de `server/persistencia/`: el cliente es el PRIMER parámetro, `data` literal, sin reglas de negocio). Son EXACTAMENTE las escrituras
 * que antes hacía en línea `src/server/actions/carta/items-agrupados.ts`; las llaman solo los casos de uso de `src/server/actions/carta/casos-de-uso/`, con la base
 * del contexto y sin transacción, como antes (un ítem agrupado no es plata: sin auditoría).
 */

/** Los campos editables de un ítem agrupado (siempre todos, alta y edición). */
interface DatosDeItemAgrupadoCarta {
  nombre: string;
  seccionCartaId: string;
  descripcion: string | null;
  tags: string[];
  especial: boolean;
  orden: number;
  generoCartaId: string | null;
}

/** Da de alta un ítem agrupado PROPIO de la sucursal. Si el nombre choca con el índice único `(sucursal, nombre)`, el error de unicidad sube tal cual. Devuelve su id y el nombre que quedó guardado. */
export async function crearItemAgrupadoDeCarta(db: Prisma.TransactionClient, args: { sucursalId: string; datos: DatosDeItemAgrupadoCarta }): Promise<{ id: string; nombre: string }> {
  const it = await db.itemAgrupadoCarta.create({ data: { sucursalId: args.sucursalId, ...args.datos } });
  return { id: it.id, nombre: it.nombre };
}

/** Cambia los campos de un ítem agrupado existente. Si el nombre choca con el índice único, el error de unicidad sube tal cual. Devuelve su id y el nombre que quedó guardado. */
export async function cambiarDatosDeItemAgrupadoCarta(db: Prisma.TransactionClient, args: { id: string; datos: DatosDeItemAgrupadoCarta }): Promise<{ id: string; nombre: string }> {
  const it = await db.itemAgrupadoCarta.update({ where: { id: args.id }, data: args.datos });
  return { id: it.id, nombre: it.nombre };
}

/** Apaga o prende un ítem agrupado (nunca se borra: apagado deja de salir en la carta, y sus opciones tampoco salen sueltas, D3). */
export async function fijarActivoDeItemAgrupadoCarta(db: Prisma.TransactionClient, args: { id: string; activo: boolean }): Promise<void> {
  await db.itemAgrupadoCarta.update({ where: { id: args.id }, data: { activo: args.activo } });
}

/** Agrega un producto como opción de un ítem agrupado (`productoId` es único por sucursal: un producto va en a lo sumo un ítem, D2). Si hay un choque, el error de unicidad sube tal cual. */
export async function crearOpcionDeItemAgrupado(db: Prisma.TransactionClient, args: { sucursalId: string; itemAgrupadoCartaId: string; productoId: string; orden: number }): Promise<void> {
  await db.opcionItemAgrupadoCarta.create({ data: { sucursalId: args.sucursalId, itemAgrupadoCartaId: args.itemAgrupadoCartaId, productoId: args.productoId, orden: args.orden } });
}

/** Cambia el orden de una opción de un ítem agrupado. */
export async function cambiarOrdenDeOpcionDeItemAgrupado(db: Prisma.TransactionClient, args: { id: string; orden: number }): Promise<void> {
  await db.opcionItemAgrupadoCarta.update({ where: { id: args.id }, data: { orden: args.orden } });
}

/** Saca un producto de su ítem agrupado: se borra solo la fila de referencia (el producto y su `ContenidoCartaProducto` no se tocan, D3). */
export async function quitarOpcionDeItemAgrupado(db: Prisma.TransactionClient, args: { id: string }): Promise<void> {
  await db.opcionItemAgrupadoCarta.deleteMany({ where: { id: args.id } });
}
