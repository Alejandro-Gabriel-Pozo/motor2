import "server-only";
import type { EstadoTraspaso, Prisma } from "@prisma/client";

/**
 * Escrituras que CIERRAN una solicitud de traspaso sin haber tocado stock (Task #41, Fase M11a; mismo contrato que
 * `cargar-traspaso.ts`: `tx` obligatorio, sin reglas de negocio — el estado nuevo lo decide `guardTransicionTraspaso`). Son EXACTAMENTE
 * los `update` que antes hacían en línea `cancelarSolicitudTransferencia` y `rechazarSolicitudTransferencia`
 * (src/server/actions/traspasos/traspasos.ts), con los mismos campos.
 */

/** Destino cancela su propia solicitud: estado nuevo + cierre (fecha y autor). */
export async function escribirCancelacionDeSolicitud(
  tx: Prisma.TransactionClient,
  args: { traspasoId: string; estadoNuevo: EstadoTraspaso; usuarioId: string; ahora: Date }
): Promise<void> {
  await tx.traspasoSucursal.update({
    where: { id: args.traspasoId },
    data: { estado: args.estadoNuevo, fechaCierre: args.ahora, cerradoPorId: args.usuarioId },
  });
}

/** Origen rechaza una solicitud: estado nuevo + decisión de Origen (fecha, autor y motivo, `null` si no dio ninguno). */
export async function escribirRechazoDeSolicitud(
  tx: Prisma.TransactionClient,
  args: { traspasoId: string; estadoNuevo: EstadoTraspaso; usuarioId: string; motivo: string | null; ahora: Date }
): Promise<void> {
  await tx.traspasoSucursal.update({
    where: { id: args.traspasoId },
    data: { estado: args.estadoNuevo, fechaDecisionOrigen: args.ahora, decididoPorOrigenId: args.usuarioId, motivoRechazoOrigen: args.motivo },
  });
}
