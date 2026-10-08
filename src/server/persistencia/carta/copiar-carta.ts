import "server-only";
import type { Prisma } from "@prisma/client";

/**
 * Escrituras de la COPIA de la carta de una sucursal a otra (`GeneroCarta`, `ItemAgrupadoCarta`, `OpcionItemAgrupadoCarta` y `ContenidoCartaProducto`; Hito 5, bloque D,
 * `docs/plan-hito-5-pureza.md` §6.1; mismo contrato que el resto de `server/persistencia/`: el cliente es el PRIMER parámetro, `data` literal, sin reglas de negocio). Son
 * EXACTAMENTE las cuatro escrituras que antes hacía en línea `src/server/actions/carta/copiar-carta.ts`; las llama solo el caso de uso `copiar-carta-de-sucursal.ts`, con el
 * `tx` de su transacción SERIALIZABLE (así dos copias a la vez no duplican ni se mezclan). Cada fila nueva es de la sucursal DESTINO (`sucursalId`).
 */

/** Copia un género a la sucursal destino. Devuelve el id nuevo (el caso de uso lo usa para reapuntar los ítems y los contenidos). */
export async function copiarGeneroDeCarta(tx: Prisma.TransactionClient, args: { sucursalId: string; nombre: string; orden: number; activo: boolean }): Promise<{ id: string }> {
  return tx.generoCarta.create({ data: { sucursalId: args.sucursalId, nombre: args.nombre, orden: args.orden, activo: args.activo }, select: { id: true } });
}

/** Copia un ítem agrupado (sin sus opciones) a la sucursal destino, con el género ya reapuntado. Devuelve el id nuevo. */
export async function copiarItemAgrupadoDeCarta(
  tx: Prisma.TransactionClient,
  args: {
    sucursalId: string;
    nombre: string;
    seccionCartaId: string;
    descripcion: string | null;
    tags: string[];
    especial: boolean;
    orden: number;
    activo: boolean;
    generoCartaId: string | null;
  },
): Promise<{ id: string }> {
  return tx.itemAgrupadoCarta.create({
    data: {
      sucursalId: args.sucursalId,
      nombre: args.nombre,
      seccionCartaId: args.seccionCartaId,
      descripcion: args.descripcion,
      tags: args.tags,
      especial: args.especial,
      orden: args.orden,
      activo: args.activo,
      generoCartaId: args.generoCartaId,
    },
    select: { id: true },
  });
}

/** Copia las opciones de un ítem agrupado (ya copiado) a la sucursal destino, en un solo INSERT. */
export async function copiarOpcionesDeItemAgrupado(
  tx: Prisma.TransactionClient,
  args: { sucursalId: string; itemAgrupadoCartaId: string; opciones: readonly { productoId: string; orden: number }[] },
): Promise<void> {
  await tx.opcionItemAgrupadoCarta.createMany({
    data: args.opciones.map((o) => ({ sucursalId: args.sucursalId, itemAgrupadoCartaId: args.itemAgrupadoCartaId, productoId: o.productoId, orden: o.orden })),
  });
}

/** Copia los contenidos de carta de los productos a la sucursal destino, con el género ya reapuntado, en un solo INSERT. */
export async function copiarContenidosDeCarta(
  tx: Prisma.TransactionClient,
  args: {
    sucursalId: string;
    contenidos: readonly {
      productoId: string;
      visibleEnCarta: boolean;
      seccionCartaId: string | null;
      descripcion: string | null;
      tags: string[];
      especial: boolean;
      orden: number;
      generoCartaId: string | null;
    }[];
  },
): Promise<void> {
  await tx.contenidoCartaProducto.createMany({
    data: args.contenidos.map((c) => ({
      sucursalId: args.sucursalId,
      productoId: c.productoId,
      visibleEnCarta: c.visibleEnCarta,
      seccionCartaId: c.seccionCartaId,
      descripcion: c.descripcion,
      tags: c.tags,
      especial: c.especial,
      orden: c.orden,
      generoCartaId: c.generoCartaId,
    })),
  });
}
