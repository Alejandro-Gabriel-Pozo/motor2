import "server-only";
import type { Prisma } from "@prisma/client";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";

/**
 * Paso compartido de «reordenar los renglones de una sección» (etapa O1): la auditoría del `orden` de un PRODUCTO en la carta de la sucursal (`ContenidoCartaProducto.orden`, `entidadId` = `${sucursalId}:${productoId}`),
 * con el mismo `tx` que la escritura. Va en su propio archivo porque cada archivo audita UNA entidad (`auditoria-por-columna.test.ts`); el ítem agrupado tiene el suyo (`auditar-orden-de-item-agrupado-en-carta.ts`).
 */
export async function auditarOrdenDeProductoEnCarta(
  tx: Prisma.TransactionClient,
  args: { sucursalId: string; productoId: string; descripcion: string; anterior: number; nuevo: number; actorId: string },
): Promise<void> {
  await registrarCambioAuditado(tx, {
    entidad: "ContenidoCartaProducto",
    entidadId: `${args.sucursalId}:${args.productoId}`,
    campo: "orden",
    descripcion: args.descripcion,
    valorAnterior: args.anterior,
    valorNuevo: args.nuevo,
    actorId: args.actorId,
    sucursalId: args.sucursalId,
  });
}
