import "server-only";
import type { Prisma } from "@prisma/client";
import { CAMPO_DE_AUDITORIA_DEL_MAIL_DE_INVITACION, descripcionDelMailDeInvitacion, desdeDelCupoDeCorreo, type MailsDeInvitacionDelDia } from "@/core/features/empresa/cupo-de-correo";

/**
 * Cuántos mails de invitación ya se reservaron en las últimas 24 horas, en la empresa y a una dirección (S-21; reglas en `core/features/empresa/cupo-de-correo.ts`). Cada mail
 * reservado deja UNA fila de auditoría (`UsuarioEmpresa.mailDeInvitacion`, la escribe `reservarMailDeInvitacion`): se cuentan esas filas y no las invitaciones, porque un reenvío
 * rota el token de la MISMA invitación y su única marca de envío (`enviadaEn`) se pisa; contar invitaciones dejaba reenviar sin tope.
 *
 * El tope se lee DENTRO de la transacción de quien reserva (`tx`, nunca `ctx.db`: GT-7), después de tomar un cerrojo por empresa (`pg_advisory_xact_lock`, que se suelta al terminar la
 * transacción): dos reservas simultáneas de la misma empresa se turnan y la segunda cuenta la fila de la primera. Es un cerrojo propio y no `FOR UPDATE` de la fila de la empresa porque
 * ese bloquearía cualquier alta que referencie a la empresa y pide un permiso de escritura sobre `Empresa` que la app no tiene. Si la transacción es SERIALIZABLE (lo es la de gobierno),
 * Postgres además detecta el choque de lecturas y la reintenta: el cerrojo evita que se llegue a eso casi siempre.
 */
export async function cupoDeCorreoDeEmpresa(tx: Prisma.TransactionClient, entrada: { empresaId: string; destinatario: string; ahora: Date }): Promise<MailsDeInvitacionDelDia> {
  await tx.$queryRaw`SELECT 1 AS tomado FROM (SELECT pg_advisory_xact_lock(hashtext(${`correo:${entrada.empresaId}`}))) AS cerrojo`;
  const desde = desdeDelCupoDeCorreo(entrada.ahora);
  const delMail = { empresaId: entrada.empresaId, entidad: "UsuarioEmpresa", campo: CAMPO_DE_AUDITORIA_DEL_MAIL_DE_INVITACION, creadoEn: { gte: desde } } as const;
  const deLaEmpresa = await tx.registroAuditoria.count({ where: delMail });
  const delDestinatario = await tx.registroAuditoria.count({ where: { ...delMail, descripcion: descripcionDelMailDeInvitacion(entrada.destinatario) } });
  return { deLaEmpresa, delDestinatario };
}
