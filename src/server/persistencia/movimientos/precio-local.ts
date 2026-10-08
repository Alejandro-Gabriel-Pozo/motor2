import "server-only";
import type { Prisma } from "@prisma/client";

/**
 * Escritura del PRECIO LOCAL de un producto en una sucursal (`PrecioLocalProducto`; Hito 4 de la pureza, bloque 4.2, paso H4C-4 — `docs/plan-hito-4-pureza.md` §3;
 * mismo contrato que el resto de `server/persistencia/`: el cliente es el PRIMER parámetro, `data` literal, sin reglas de negocio). Es EXACTAMENTE lo que antes
 * hacía en línea el ayudante `guardarPrecioLocal` de `src/server/actions/movimientos/precio-local.ts`: leer la fila actual del par (sucursal, producto) y
 * hacer el upsert, en ese orden. La llama solo el paso compartido `src/server/actions/movimientos/casos-de-uso/guardar-precio-local-en-tx.ts`, dentro de la
 * transacción del caso de uso y antes de sus dos filas de auditoría (que escribe él: la persistencia no audita, `escrituras-auditadas.test.ts` exige la cadena).
 *
 * Es uno de los lectores crudos de `PrecioLocalProducto` que admite `precio-local-en-un-solo-lugar.test.ts`: lee la fila ANTERIOR para la auditoría, no decide
 * qué precio rige (eso es `preciosLocalesVigentes`, con la capacidad de la sucursal).
 */

/** Lo que había antes del cambio (para la auditoría), o `null` si el producto no tenía precio local en la sucursal. */
export interface PrecioLocalAnterior {
  precio: number;
  habilitado: boolean;
}

/** Crea o cambia el precio local (y si está habilitado) del producto en la sucursal. Devuelve el id de la fila y lo que había antes. */
export async function escribirPrecioLocal(
  db: Prisma.TransactionClient,
  args: { sucursalId: string; productoId: string; precio: number; habilitado: boolean },
): Promise<{ id: string; anterior: PrecioLocalAnterior | null }> {
  const clave = { sucursalId_productoId: { sucursalId: args.sucursalId, productoId: args.productoId } };
  const existente = await db.precioLocalProducto.findUnique({ where: clave });
  const fila = await db.precioLocalProducto.upsert({
    where: clave,
    update: { precio: args.precio, habilitado: args.habilitado },
    create: { sucursalId: args.sucursalId, productoId: args.productoId, precio: args.precio, habilitado: args.habilitado },
  });
  return { id: fila.id, anterior: existente ? { precio: Number(existente.precio), habilitado: existente.habilitado } : null };
}
