import "server-only";
import type { Prisma } from "@prisma/client";

/**
 * Escrituras y lecturas de la marca «Ocultar» de un producto (`OcultamientoProducto`; docs/diseno-ocultar-como-pedernal-2026-11-15.md, nivel 6). Mismo contrato que el resto de
 * `server/persistencia/`: el `tx` de la transacción del caso de uso, `data` literal, sin reglas de negocio ni auditoría (la escribe el caso de uso con el mismo `tx`).
 *
 * Una fila por (producto, alcance): `sucursalId` nulo = toda la empresa. SIN FILA = VISIBLE. Nunca se borra: «volver a mostrar» es `oculto = false`. El UPDATE toca solo las
 * columnas con GRANT (`oculto`, `actualizadoPorId`, `actualizadoEn`, `version`) y lleva la versión esperada (control de versión: si otra escritura se coló, no pisa y avisa con `false`).
 * Los índices únicos parciales de la migración son la segunda barrera: dos altas a la vez de la misma marca no dejan dos filas.
 */

type Tx = Prisma.TransactionClient;

/** Las marcas del producto que ve el contexto (la RLS acota por sucursal). Sirve para `ocultoPor` / `marcasDeOcultar` (src/core/catalogo/ocultar-producto.ts). */
export async function leerMarcasDeOcultar(tx: Tx, productoId: string): Promise<{ id: string; sucursalId: string | null; oculto: boolean; version: number }[]> {
  return tx.ocultamientoProducto.findMany({ where: { productoId }, select: { id: true, sucursalId: true, oculto: true, version: true } });
}

/** Alta de la marca de un alcance. El `id` lo manda la aplicación (uuid): es la clave de la idempotencia del alta. */
export async function crearMarcaDeOcultar(
  tx: Tx,
  args: { id: string; productoId: string; sucursalId: string | null; oculto: boolean; actorId: string; ahora: Date },
): Promise<void> {
  await tx.ocultamientoProducto.create({
    data: { id: args.id, productoId: args.productoId, sucursalId: args.sucursalId, oculto: args.oculto, actualizadoPorId: args.actorId, actualizadoEn: args.ahora },
  });
}

/** Cambia el estado de una marca ya creada, con control de versión. Devuelve `false` si la versión ya no es la esperada (alguien la cambió antes). */
export async function cambiarMarcaDeOcultar(
  tx: Tx,
  args: { id: string; versionEsperada: number; oculto: boolean; actorId: string; ahora: Date },
): Promise<boolean> {
  const { count } = await tx.ocultamientoProducto.updateMany({
    where: { id: args.id, version: args.versionEsperada },
    data: { oculto: args.oculto, actualizadoPorId: args.actorId, actualizadoEn: args.ahora, version: args.versionEsperada + 1 },
  });
  return count === 1;
}
