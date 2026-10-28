import "server-only";
import type { Prisma } from "@prisma/client";
import type { ContenidoAEscribir } from "@/core/features/catalogo/importacion/planificar-carta";

/**
 * Escrituras del CONTENIDO de carta de un producto (`ContenidoCartaProducto`; Hito 5, bloque D, `docs/plan-hito-5-pureza.md` §6.1; mismo contrato que el resto de
 * `server/persistencia/`: el cliente es el PRIMER parámetro, `data` literal, sin reglas de negocio). Los dos `upsert` son EXACTAMENTE los que antes hacía en línea
 * `src/server/actions/carta/contenido-producto.ts`; los llaman solo los casos de uso `guardar-contenido-carta-producto.ts` y `actualizar-visible-en-carta.ts` de
 * `src/server/actions/carta/casos-de-uso/` (el primero, desde la Fase 5, dentro de la transacción de su caso de uso, junto con la auditoría de «Mostrar el nombre arriba»; el segundo con la base del
 * contexto y sin transacción, como antes; una fila por (sucursal, producto): la carta es propia de cada sucursal). CARTA-MANT suma
 * el `create` de «Agregar a la carta» y el borrado de «Quitar de la carta», cada uno dentro de la transacción de su caso de uso.
 */

/** Los campos que fija el formulario completo del contenido (siempre todos, salvo «Mostrar el nombre arriba»: solo si el formulario lo trae; si no, queda como estaba). */
interface DatosDeContenidoDeCarta {
  visibleEnCarta: boolean;
  seccionCartaId: string | null;
  descripcion: string | null;
  tags: string[];
  especial: boolean;
  orden: number;
  generoCartaId: string | null;
  /** Fase 5 (DEC-11): el interruptor de un producto base con un solo eje. `undefined` = no se toca (Prisma ignora la clave). */
  mostrarNombreArriba?: boolean;
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

/**
 * Importador del catálogo (E1.4; docs/diseno-importador-de-catalogo-2026-10-28.md, ADENDA A.2 y A.4): CREA en UN viaje el contenido de carta de la carga inicial (visible, en su sección,
 * con la descripción de la fila y su orden). `createMany` y no `upsert`, como `crearContenidoVisibleDeProducto`: nunca pisa un contenido existente; si otro lo creó a la vez, el único
 * `(sucursalId, productoId)` choca (P2002) y aborta la importación entera. Lo llama solo `actions/catalogo/casos-de-uso/importar-catalogo.ts`, dentro de su transacción y con la
 * auditoría de cada contenido (`visibleEnCarta`, de null a true, con la sucursal: la misma que deja «Agregar a la carta») en el mismo `tx`.
 */
export async function crearContenidosImportados(db: Prisma.TransactionClient, contenidos: readonly ContenidoAEscribir[]): Promise<number> {
  if (contenidos.length === 0) return 0;
  const { count } = await db.contenidoCartaProducto.createMany({
    data: contenidos.map((c) => ({
      sucursalId: c.sucursalId,
      productoId: c.productoId,
      visibleEnCarta: c.visibleEnCarta,
      seccionCartaId: c.seccionCartaId,
      descripcion: c.descripcion,
      orden: c.orden,
      especial: c.especial,
      tags: c.tags,
      generoCartaId: c.generoCartaId,
      mostrarNombreArriba: c.mostrarNombreArriba,
    })),
  });
  return count;
}
