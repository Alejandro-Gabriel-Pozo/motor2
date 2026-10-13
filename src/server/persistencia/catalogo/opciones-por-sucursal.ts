import "server-only";
import type { Prisma } from "@prisma/client";

/**
 * Escrituras de lo que decide cada SUCURSAL sobre las opciones de venta (GO-2a; ADR-030 §5). Mismo contrato que el resto de `server/persistencia/`: el `tx` de la transacción
 * SERIALIZABLE del caso de uso, `data` literal, sin reglas de negocio ni auditoría (la escribe el caso de uso con el mismo `tx`).
 *
 * Las dos tablas son PROPIAS de la sucursal: las políticas RESTRICTIVE de GO-1c-rls solo dejan escribir en las del alcance de escritura del contexto (la sucursal activa), así que una
 * fila de otra sucursal da 42501 aunque el caso de uso se equivocara de id. `upsert` por la clave natural; el UPDATE toca SOLO las columnas con GRANT (el apagado: `apagada`,
 * `actualizadoPorId`, `actualizadoEn`; la grilla: `precio`, `habilitado`, `actualizadoEn`). Nunca DELETE: dar de baja la grilla es `habilitado = false`.
 */

type Tx = Prisma.TransactionClient;

/** Lleva la opción al estado `apagada` en la sucursal (sin fila = prendida). */
export async function fijarApagadoDeOpcion(tx: Tx, args: { sucursalId: string; opcionId: string; apagada: boolean; actorId: string; ahora: Date }): Promise<void> {
  await tx.opcionApagadaEnSucursal.upsert({
    where: { sucursalId_opcionId: { sucursalId: args.sucursalId, opcionId: args.opcionId } },
    create: { sucursalId: args.sucursalId, opcionId: args.opcionId, apagada: args.apagada, actualizadoPorId: args.actorId, actualizadoEn: args.ahora },
    update: { apagada: args.apagada, actualizadoPorId: args.actorId, actualizadoEn: args.ahora },
  });
}

/** El precio de la opción para el producto en la sucursal (la grilla), habilitado o no. */
export async function fijarPrecioLocalDeOpcion(
  tx: Tx,
  args: { sucursalId: string; productoId: string; opcionId: string; precio: number; habilitado: boolean; ahora: Date }
): Promise<void> {
  await tx.precioLocalDeOpcion.upsert({
    where: { sucursalId_productoId_opcionId: { sucursalId: args.sucursalId, productoId: args.productoId, opcionId: args.opcionId } },
    create: { sucursalId: args.sucursalId, productoId: args.productoId, opcionId: args.opcionId, precio: args.precio, habilitado: args.habilitado, actualizadoEn: args.ahora },
    update: { precio: args.precio, habilitado: args.habilitado, actualizadoEn: args.ahora },
  });
}
