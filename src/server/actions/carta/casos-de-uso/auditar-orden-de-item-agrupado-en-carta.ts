import "server-only";
import type { Prisma } from "@prisma/client";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";

/**
 * Paso compartido de «reordenar los renglones de una sección» (etapa O1): la auditoría del `orden` de un ÍTEM AGRUPADO en la carta de la sucursal (`ItemAgrupadoCarta.orden`, `entidadId` = `${sucursalId}:${itemId}`),
 * con el mismo `tx` que la escritura. Va en su propio archivo porque cada archivo audita UNA entidad (`auditoria-por-columna.test.ts`); el producto tiene el suyo (`auditar-orden-de-producto-en-carta.ts`).
 */
export async function auditarOrdenDeItemAgrupadoEnCarta(
  tx: Prisma.TransactionClient,
  args: { sucursalId: string; itemId: string; descripcion: string; anterior: number; nuevo: number; actorId: string },
): Promise<void> {
  await registrarCambioAuditado(tx, {
    entidad: "ItemAgrupadoCarta",
    entidadId: `${args.sucursalId}:${args.itemId}`,
    campo: "orden",
    descripcion: args.descripcion,
    valorAnterior: args.anterior,
    valorNuevo: args.nuevo,
    actorId: args.actorId,
    sucursalId: args.sucursalId,
  });
}
