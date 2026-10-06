import "server-only";
import type { Prisma } from "@prisma/client";

/**
 * Escritura de la ANULACIÓN de un ítem ya enviado a cocina (Task #41, Fase M12c — docs/arquitectura-casos-de-uso-2026-09-27.md; mismo
 * contrato que `cerrar-cuenta.ts`: `tx` OBLIGATORIO, sin reglas de negocio). Es EXACTAMENTE el `create` que antes hacía en línea
 * `anularItemEnviado` (src/server/actions/pos/cuenta-anulacion.ts). La cantidad (ya validada, y cuánto) la decide el caso de uso
 * (src/server/actions/pos/casos-de-uso/anular-item-enviado.ts); la auditoría la escribe él después.
 *
 * Desde M12d también la usa `anular-promo-enviada.ts`, una vez por componente de la promo: es el mismo `create` que hacía en línea
 * `anularPromoEnviada`, que además copiaba `promoCuentaId` y `precioCartaUnitario` del componente (el argumento opcional `promo`).
 */

/**
 * La fila ESPEJO: un CuentaItem nuevo con la cantidad en NEGATIVO, mismo producto/precio/envío que el original, `anulaAItemId` al
 * original, el motivo ya validado y quién anuló. El original nunca se edita ni se borra (lo que queda lo calcula `restanteDe`).
 * `cantidadAnulada` va en POSITIVO: el signo lo pone esta función. Devuelve el id de la fila espejo.
 *
 * `precioCartaUnitario` del original se copia SIEMPRE (producto con descuento, Fase 2: el precio de lista es parte de la clave de la línea, y el espejo
 * tiene que netear con su original). `promo` (solo para un componente de promo, Task #16): además, el MISMO `promoCuentaId`.
 */
export async function escribirEspejoDeItem(
  tx: Prisma.TransactionClient,
  args: {
    original: { id: string; cuentaId: string; productoId: string; precioUnitario: number; precioCartaUnitario: number | null; numeroEnvio: number };
    cantidadAnulada: number;
    motivo: string;
    creadoPorId: string;
    promo?: { promoCuentaId: string };
  }
): Promise<string> {
  const { id } = await tx.cuentaItem.create({
    data: {
      cuentaId: args.original.cuentaId,
      productoId: args.original.productoId,
      cantidad: -args.cantidadAnulada,
      precioUnitario: args.original.precioUnitario,
      precioCartaUnitario: args.original.precioCartaUnitario,
      numeroEnvio: args.original.numeroEnvio,
      anulaAItemId: args.original.id,
      motivoAnulacion: args.motivo,
      creadoPorId: args.creadoPorId,
      ...(args.promo ? { promoCuentaId: args.promo.promoCuentaId } : {}),
    },
    select: { id: true },
  });
  return id;
}
