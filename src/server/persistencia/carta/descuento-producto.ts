import "server-only";
import type { Prisma } from "@prisma/client";

/**
 * Escrituras del DESCUENTO de un producto en una sucursal (`DescuentoProductoSucursal`; Hito 4 de la pureza, bloque 4.2, paso H4C-1 — `docs/plan-hito-4-pureza.md`
 * §3; mismo contrato que el resto de `server/persistencia/`: el cliente es el PRIMER parámetro, `data` literal, sin reglas de negocio). Son EXACTAMENTE las dos
 * escrituras que antes hacía en línea `src/server/actions/carta/descuento-producto.ts`; las llama solo el caso de uso
 * `src/server/actions/carta/casos-de-uso/guardar-descuento-producto.ts`, dentro de su transacción y junto con la fila de auditoría (que escribe él: la
 * persistencia no audita, `escrituras-auditadas.test.ts` exige la cadena).
 */

/** Borra la fila del descuento (sacar el descuento: fila ausente = sin descuento). */
export async function borrarDescuentoProducto(db: Prisma.TransactionClient, args: { id: string }): Promise<void> {
  await db.descuentoProductoSucursal.delete({ where: { id: args.id } });
}

/** Crea o cambia el % del producto en la sucursal (una sola fila por par, `@@unique([productoId, sucursalId])`). Devuelve el id de la fila, para la auditoría. */
export async function fijarDescuentoProducto(
  db: Prisma.TransactionClient,
  args: { productoId: string; sucursalId: string; porcentaje: number },
): Promise<{ id: string }> {
  const fila = await db.descuentoProductoSucursal.upsert({
    where: { productoId_sucursalId: { productoId: args.productoId, sucursalId: args.sucursalId } },
    create: { productoId: args.productoId, sucursalId: args.sucursalId, porcentaje: args.porcentaje },
    update: { porcentaje: args.porcentaje },
  });
  return { id: fila.id };
}
