import "server-only";
import type { Prisma } from "@prisma/client";

/**
 * Escritura de el TICKET CORREGIDO (Task #41, Fase M12b — docs/arquitectura-casos-de-uso-2026-09-27.md; mismo contrato que
 * `cerrar-cuenta.ts`: `tx` OBLIGATORIO, sin reglas de negocio). Es EXACTAMENTE el `create` que antes hacía en línea `emitirTicketCorregido`
 * (src/server/actions/pos/cuenta-cierre.ts). El número, el ejemplar y a quién corrige los decide el caso de uso
 * (src/server/actions/pos/casos-de-uso/emitir-ticket-corregido.ts); la auditoría la escribe él después.
 */

/**
 * Un ejemplar de corrección (B, C…) del ticket: MISMO número que el A, `corrigeAId` al A y el motivo ya validado. Nunca edita ni borra
 * un ejemplar. Devuelve el id del ejemplar nuevo.
 */
export async function escribirEjemplarCorregido(
  tx: Prisma.TransactionClient,
  args: { sucursalId: string; cuentaId: string; numero: number; ejemplar: number; emitidoEn: Date; emitidoPorId: string; corrigeAId: string; motivo: string }
): Promise<string> {
  const { id } = await tx.ejemplarTicket.create({
    data: {
      sucursalId: args.sucursalId,
      cuentaId: args.cuentaId,
      numero: args.numero,
      ejemplar: args.ejemplar,
      emitidoEn: args.emitidoEn,
      emitidoPorId: args.emitidoPorId,
      corrigeAId: args.corrigeAId,
      motivo: args.motivo,
    },
    select: { id: true },
  });
  return id;
}
