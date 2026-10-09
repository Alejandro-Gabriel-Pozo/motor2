import "server-only";
import type { Prisma } from "@prisma/client";

/**
 * Escrituras del REGISTRO PÚBLICO de las sucursales en el portal (`SucursalPublica`; Hito 5, bloque D, `docs/plan-hito-5-pureza.md` §6.1; mismo contrato que el resto de
 * `server/persistencia/`: el cliente es el PRIMER parámetro, `data` literal, sin reglas de negocio). Son EXACTAMENTE las cuatro escrituras que antes hacía en línea
 * `src/server/actions/carta/registro-publico.ts`; las llaman solo los casos de uso de `src/server/actions/carta/casos-de-uso/`, con la base del contexto y sin
 * transacción, como antes (el registro del portal no es plata: sin auditoría). Si el slug choca con el índice único, el error de unicidad sube tal cual: lo traduce el
 * caso de uso.
 */

/** Da de alta la fila de una sucursal en el portal, SIN publicar (el resto de los campos queda en su valor por defecto). */
export async function crearRegistroPublicoDeSucursal(db: Prisma.TransactionClient, args: { sucursalId: string; slug: string }): Promise<void> {
  await db.sucursalPublica.create({ data: { sucursalId: args.sucursalId, slug: args.slug } });
}

/** Los campos que se guardan del registro público de una sucursal (siempre todos). */
interface DatosDeRegistroPublico {
  slug: string;
  etiqueta: string | null;
  subtituloPortal: string | null;
  posX: number | null;
  posY: number | null;
  posW: number | null;
  posH: number | null;
  orden: number;
  publicada: boolean;
}

/** Guarda el registro público de una sucursal que ya está en el portal. */
export async function guardarRegistroPublicoDeSucursal(db: Prisma.TransactionClient, args: { id: string; datos: DatosDeRegistroPublico }): Promise<void> {
  await db.sucursalPublica.update({
    where: { id: args.id },
    data: {
      slug: args.datos.slug,
      etiqueta: args.datos.etiqueta,
      subtituloPortal: args.datos.subtituloPortal,
      posX: args.datos.posX,
      posY: args.datos.posY,
      posW: args.datos.posW,
      posH: args.datos.posH,
      orden: args.datos.orden,
      publicada: args.datos.publicada,
    },
  });
}

/** Borra la fila de una sucursal del portal (la vuelta atrás del alta: la sucursal desaparece del portal, la sucursal en sí no se toca). */
export async function quitarRegistroPublicoDeSucursal(db: Prisma.TransactionClient, args: { id: string }): Promise<void> {
  await db.sucursalPublica.deleteMany({ where: { id: args.id } });
}

/** Mueve la tarjeta de una sucursal sobre el mapa: guarda SOLO `posX` y `posY` (el ancho y el alto quedan como estaban). */
export async function moverRegistroPublicoEnMapa(db: Prisma.TransactionClient, args: { id: string; posX: number | null; posY: number | null }): Promise<void> {
  await db.sucursalPublica.update({ where: { id: args.id }, data: { posX: args.posX, posY: args.posY } });
}
