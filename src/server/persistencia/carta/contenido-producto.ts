import "server-only";
import type { Prisma } from "@prisma/client";

/**
 * Escrituras del CONTENIDO de carta de un producto (`ContenidoCartaProducto`; Hito 5, bloque D, `docs/plan-hito-5-pureza.md` §6.1; mismo contrato que el resto de
 * `server/persistencia/`: el cliente es el PRIMER parámetro, `data` literal, sin reglas de negocio). Son EXACTAMENTE los dos `upsert` que antes hacía en línea
 * `src/server/actions/carta/contenido-producto.ts`; los llaman solo los casos de uso `guardar-contenido-carta-producto.ts` y `actualizar-visible-en-carta.ts` de
 * `src/server/actions/carta/casos-de-uso/`, con la base del contexto y sin transacción, como antes (una fila por (sucursal, producto): la carta es propia de cada sucursal).
 */

/** Los campos que fija el formulario completo del contenido (siempre todos). */
interface DatosDeContenidoDeCarta {
  visibleEnCarta: boolean;
  seccionCartaId: string | null;
  descripcion: string | null;
  tags: string[];
  especial: boolean;
  orden: number;
  generoCartaId: string | null;
}

/** Crea o reemplaza el contenido completo del producto en la sucursal (una sola fila por par, `@@unique([sucursalId, productoId])`). */
export async function guardarContenidoDeProducto(db: Prisma.TransactionClient, args: { sucursalId: string; productoId: string; datos: DatosDeContenidoDeCarta }): Promise<void> {
  const { sucursalId, productoId, datos } = args;
  await db.contenidoCartaProducto.upsert({
    where: { sucursalId_productoId: { sucursalId, productoId } },
    update: datos,
    create: { sucursalId, productoId, ...datos },
  });
}

/** Muestra u oculta el producto sin tocar el resto del contenido (crea la fila si no existía, con el resto vacío). */
export async function fijarVisibleEnCarta(db: Prisma.TransactionClient, args: { sucursalId: string; productoId: string; visibleEnCarta: boolean }): Promise<void> {
  const { sucursalId, productoId, visibleEnCarta } = args;
  await db.contenidoCartaProducto.upsert({
    where: { sucursalId_productoId: { sucursalId, productoId } },
    update: { visibleEnCarta },
    create: { sucursalId, productoId, visibleEnCarta },
  });
}
