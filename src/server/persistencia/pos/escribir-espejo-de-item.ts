import "server-only";
import type { Prisma } from "@prisma/client";

/**
 * Escritura de la ANULACIÓN de un ítem ya enviado a cocina (Task #41, Fase M12c — docs/arquitectura-casos-de-uso-2026-09-27.md; mismo
 * contrato que `cerrar-cuenta.ts`: `tx` OBLIGATORIO, sin reglas de negocio). Es EXACTAMENTE el `create` que antes hacía en línea
 * `anularItemEnviado` (src/server/actions/pos/cuenta-anulacion.ts). La cantidad (ya validada, y cuánto) la decide el caso de uso
 * (src/server/actions/pos/casos-de-uso/anular-item-enviado.ts); la auditoría la escribe él después.
 */

/**
 * La fila ESPEJO: un CuentaItem nuevo con la cantidad en NEGATIVO, mismo producto/precio/envío que el original, `anulaAItemId` al
 * original, el motivo ya validado y quién anuló. El original nunca se edita ni se borra (lo que queda lo calcula `restanteDe`).
 * `cantidadAnulada` va en POSITIVO: el signo lo pone esta función. Devuelve el id de la fila espejo.
 */
export async function escribirEspejoDeItem(
  tx: Prisma.TransactionClient,
  args: {
    original: { id: string; cuentaId: string; productoId: string; precioUnitario: number; numeroEnvio: number };
    cantidadAnulada: number;
    motivo: string;
    creadoPorId: string;
  }
): Promise<string> {
  const { id } = await tx.cuentaItem.create({
    data: {
      cuentaId: args.original.cuentaId,
      productoId: args.original.productoId,
      cantidad: -args.cantidadAnulada,
      precioUnitario: args.original.precioUnitario,
      numeroEnvio: args.original.numeroEnvio,
      anulaAItemId: args.original.id,
      motivoAnulacion: args.motivo,
      creadoPorId: args.creadoPorId,
    },
    select: { id: true },
  });
  return id;
}
