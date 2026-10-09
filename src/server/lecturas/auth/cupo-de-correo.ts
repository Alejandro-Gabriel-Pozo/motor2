import "server-only";
import type { Prisma } from "@prisma/client";
import { CAMPO_DE_AUDITORIA_DEL_MAIL_DE_INVITACION, descripcionDelMailDeInvitacion, desdeDelCupoDeCorreo, type MailsDeInvitacionDelDia } from "@/core/features/empresa/cupo-de-correo";

/**
 * Cuántos mails de invitación ya se reservaron en las últimas 24 horas, en la empresa y a una dirección (S-21; reglas en `core/features/empresa/cupo-de-correo.ts`). Cada mail
 * reservado deja UNA fila de auditoría (`UsuarioEmpresa.mailDeInvitacion`, la escribe `reservarMailDeInvitacion`): se cuentan esas filas y no las invitaciones, porque un reenvío
 * rota el token de la MISMA invitación y su única marca de envío (`enviadaEn`) se pisa; contar invitaciones dejaba reenviar sin tope.
 *
 * El tope se lee DENTRO de la transacción de quien reserva (`tx`, nunca `ctx.db`: GT-7), después de tomar un cerrojo por empresa (`pg_advisory_xact_lock`, que se suelta al terminar la
 * transacción). Es un cerrojo propio y no `FOR UPDATE` de la fila de la empresa porque ese bloquearía cualquier alta que referencie a la empresa y pide un permiso de escritura sobre
 * `Empresa` que la app no tiene.
 *
 * Qué frena a qué (corregido en M-14 de la auditoría intermedia; antes decía que la segunda reserva «cuenta la fila de la primera», y eso solo vale con aislamiento común):
 *  - con aislamiento COMÚN (READ COMMITTED) el cerrojo basta: cada sentencia toma su foto después de esperar el cerrojo, así que la segunda reserva SÍ ve la fila que dejó la primera;
 *  - con SERIALIZABLE (lo es la transacción de gobierno, que es por donde pasa todo mail real) la foto de la transacción se toma en su PRIMERA sentencia, ANTES del cerrojo, así que la segunda NO
 *    ve la fila de la primera aunque haya esperado: lo que la frena es la detección de conflictos de Postgres, que la aborta (P2034) y `conTransaccionSerializable` la reintenta con una foto nueva.
 *    El cerrojo solo hace que esos choques sean pocos, porque las reservas se turnan en vez de pisarse. Con mucha concurrencia sobre la misma empresa los reintentos pueden agotarse: ese caso lo
 *    atrapa `conCupoDeCorreo` y devuelve el mensaje del cupo (`MENSAJE_DE_CUPO_DE_CORREO_POR_CONCURRENCIA`), nunca un mail de más.
 */
export async function cupoDeCorreoDeEmpresa(tx: Prisma.TransactionClient, entrada: { empresaId: string; destinatario: string; ahora: Date }): Promise<MailsDeInvitacionDelDia> {
  await tx.$queryRaw`SELECT 1 AS tomado FROM (SELECT pg_advisory_xact_lock(hashtext(${`correo:${entrada.empresaId}`}))) AS cerrojo`;
  const desde = desdeDelCupoDeCorreo(entrada.ahora);
  const delMail = { empresaId: entrada.empresaId, entidad: "UsuarioEmpresa", campo: CAMPO_DE_AUDITORIA_DEL_MAIL_DE_INVITACION, creadoEn: { gte: desde } } as const;
  const deLaEmpresa = await tx.registroAuditoria.count({ where: delMail });
  const delDestinatario = await tx.registroAuditoria.count({ where: { ...delMail, descripcion: descripcionDelMailDeInvitacion(entrada.destinatario) } });
  return { deLaEmpresa, delDestinatario };
}
