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

/**
 * CARTA-MANT («Agregar a la carta»): CREA el contenido de un producto que no tenía (visible, en su sección y con su orden; el resto vacío). `create`, no `upsert`: si otro lo creó a la vez, el
 * único `(sucursalId, productoId)` choca (23505) y el caso de uso reintenta y relee; nunca pisa un contenido existente. Lo llama solo `casos-de-uso/agregar-producto-a-la-carta.ts`, dentro de su transacción.
 */
export async function crearContenidoVisibleDeProducto(db: Prisma.TransactionClient, args: { sucursalId: string; productoId: string; seccionCartaId: string; orden: number }): Promise<void> {
  const { sucursalId, productoId, seccionCartaId, orden } = args;
  await db.contenidoCartaProducto.create({ data: { sucursalId, productoId, visibleEnCarta: true, seccionCartaId, orden } });
}

/**
 * CARTA-MANT («Quitar de la carta», decisión del dueño 2026-10-14): BORRA el contenido de carta del producto en la sucursal (vuelve a «Fuera de carta»). Ninguna tabla referencia esta fila (solo ella
 * referencia al producto, la sección y el género), así que no deja nada colgado. `deleteMany` por la clave única: si otro ya la borró, borra 0 y no falla. Lo llama solo
 * `casos-de-uso/quitar-producto-de-la-carta.ts`, dentro de su transacción y después de auditar cada dato que tenía.
 */
export async function borrarContenidoDeProducto(db: Prisma.TransactionClient, args: { sucursalId: string; productoId: string }): Promise<number> {
  return (await db.contenidoCartaProducto.deleteMany({ where: { sucursalId: args.sucursalId, productoId: args.productoId } })).count;
}
