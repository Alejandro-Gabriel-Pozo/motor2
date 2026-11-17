import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import { GENERO_E_ITEM_AGRUPADO_VISIBLE, whereCartaDeSucursal } from "@/core/carta/public";
import type { TipoDeRenglonDeCarta } from "@/core/features/carta/orden-de-renglones.schema";

/**
 * Lecturas y escrituras del orden de los renglones de una sección de carta (`ModoDeOrdenDeSeccionCarta`, `ContenidoCartaProducto.orden`, `ItemAgrupadoCarta.orden`; etapa O1). Mismo contrato que el resto de
 * `server/persistencia/`: el `tx` de la transacción del caso de uso, `data` literal, sin reglas de negocio ni auditoría (la escribe el caso de uso con el mismo `tx`). La carta es PROPIA de cada sucursal: toda
 * lectura y escritura de renglones lleva `whereCartaDeSucursal` con la sucursal activa. Los UPDATE tocan solo columnas con GRANT (`modo`, `actualizadoPorId`, `actualizadoEn`, `version`; `orden`).
 */

type Tx = Prisma.TransactionClient;

/** La sección, si es de la empresa (la RLS no deja ver las de otra). */
export async function leerSeccionParaOrdenar(tx: Tx, seccionCartaId: string): Promise<{ id: string; nombre: string } | null> {
  return tx.seccionCarta.findUnique({ where: { id: seccionCartaId }, select: { id: true, nombre: true } });
}

/** ¿La sección tiene ítems agrupados activos en esta sucursal? Lo usa el caso de uso para pedir, además, el permiso de los ítems agrupados. */
export async function haySeccionConItemsAgrupados(db: Tx | PrismaClient, args: { sucursalId: string; seccionCartaId: string }): Promise<boolean> {
  if (!GENERO_E_ITEM_AGRUPADO_VISIBLE) return false; // interruptor de ítem agrupado apagado: no hay ítems agrupados en la carta
  return (await db.itemAgrupadoCarta.count({ where: { ...whereCartaDeSucursal(args.sucursalId), seccionCartaId: args.seccionCartaId, activo: true } })) > 0;
}

/** ¿Existe el renglón en la carta de ESTA sucursal (aunque hoy esté oculto, apagado o en otra sección)? Distingue «cambió» de «no existe». */
export async function existeRenglonEnLaSucursal(tx: Tx, args: { sucursalId: string; tipo: TipoDeRenglonDeCarta; id: string }): Promise<boolean> {
  if (args.tipo === "PRODUCTO") return (await tx.contenidoCartaProducto.findFirst({ where: { ...whereCartaDeSucursal(args.sucursalId), productoId: args.id }, select: { id: true } })) !== null;
  return (await tx.itemAgrupadoCarta.findFirst({ where: { ...whereCartaDeSucursal(args.sucursalId), id: args.id }, select: { id: true } })) !== null;
}

/** Fija el `orden` de un renglón de esta sucursal. */
export async function fijarOrdenDeRenglon(tx: Tx, args: { sucursalId: string; tipo: TipoDeRenglonDeCarta; id: string; orden: number }): Promise<void> {
  if (args.tipo === "PRODUCTO") {
    await tx.contenidoCartaProducto.updateMany({ where: { sucursalId: args.sucursalId, productoId: args.id }, data: { orden: args.orden } });
  } else {
    await tx.itemAgrupadoCarta.updateMany({ where: { sucursalId: args.sucursalId, id: args.id }, data: { orden: args.orden } });
  }
}

/** El modo de orden de la sección en esta sucursal, o `null` si no hay fila (= `A_MANO`). */
export async function leerModoDeOrden(tx: Tx, args: { sucursalId: string; seccionCartaId: string }): Promise<{ id: string; modo: string; version: number } | null> {
  return tx.modoDeOrdenDeSeccionCarta.findUnique({
    where: { sucursalId_seccionCartaId: { sucursalId: args.sucursalId, seccionCartaId: args.seccionCartaId } },
    select: { id: true, modo: true, version: true },
  });
}

/** Alta del modo de una sección en la sucursal. El `id` lo manda la aplicación (uuid). */
export async function crearModoDeOrden(
  tx: Tx,
  args: { id: string; sucursalId: string; seccionCartaId: string; modo: string; actorId: string; ahora: Date },
): Promise<void> {
  await tx.modoDeOrdenDeSeccionCarta.create({
    data: { id: args.id, sucursalId: args.sucursalId, seccionCartaId: args.seccionCartaId, modo: args.modo, actualizadoPorId: args.actorId, actualizadoEn: args.ahora },
  });
}

/** Cambia el modo de una fila ya creada, con control de versión. Devuelve `false` si la versión ya no es la esperada (alguien la cambió antes). */
export async function cambiarModoDeOrden(tx: Tx, args: { id: string; versionEsperada: number; modo: string; actorId: string; ahora: Date }): Promise<boolean> {
  const { count } = await tx.modoDeOrdenDeSeccionCarta.updateMany({
    where: { id: args.id, version: args.versionEsperada },
    data: { modo: args.modo, actualizadoPorId: args.actorId, actualizadoEn: args.ahora, version: args.versionEsperada + 1 },
  });
  return count === 1;
}
