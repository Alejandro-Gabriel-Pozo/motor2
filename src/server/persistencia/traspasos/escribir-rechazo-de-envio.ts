import "server-only";
import type { EstadoTraspaso, Prisma } from "@prisma/client";

/**
 * Escritura del RECHAZO de un envío por Destino (Task #41, Fase M11b; mismo contrato que `cargar-traspaso.ts`: `tx` obligatorio, sin
 * reglas de negocio — el estado nuevo lo decide `guardTransicionTraspaso`). Es EXACTAMENTE el `update` que antes hacía en línea
 * `rechazarTransferencia` (src/server/actions/traspasos/traspasos.ts): todavía NO toca stock, el reingreso lo confirma Origen aparte.
 */
export async function escribirRechazoDeEnvio(
  tx: Prisma.TransactionClient,
  args: { traspasoId: string; estadoNuevo: EstadoTraspaso; usuarioId: string; motivo: string | null; ahora: Date }
): Promise<void> {
  await tx.traspasoSucursal.update({
    where: { id: args.traspasoId },
    data: { estado: args.estadoNuevo, fechaDecisionDestino: args.ahora, decididoPorDestinoId: args.usuarioId, motivoRechazoDestino: args.motivo },
  });
}
