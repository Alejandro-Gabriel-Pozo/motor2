import "server-only";
import type { Prisma } from "@prisma/client";
import { dbPlataforma } from "../db";

/** Acciones de la propia consola que se anotan en la auditoría de plataforma. Las que actúan sobre una empresa llevan `empresaAfectadaId` (E5). */
export type AccionDePlataforma =
  | "ingreso"
  | "cierre-de-sesion"
  | "segundo-factor-fallido"
  | "bloqueo-por-fallos"
  | "alta-de-empresa"
  | "invitacion-reenviada"
  | "invitacion-revocada"
  | "invitacion-creada"
  | "empresa-confirmada"
  | "cuit-corregido"
  | "empresa-suspendida"
  | "empresa-reactivada"
  | "aviso-de-activacion";

export interface Autor {
  adminId: string;
  adminEmail: string;
}

/**
 * Anota qué hizo un administrador, con él como autor (ADR-012 §7). El `detalle` nunca lleva códigos, tokens ni secretos: solo hechos
 * (por ejemplo, qué factor se usó).
 */
export async function auditarAccionDePlataforma(autor: Autor, accion: AccionDePlataforma, detalle?: Record<string, string | number | boolean>): Promise<void> {
  await dbPlataforma().auditoriaPlataforma.create({ data: { adminId: autor.adminId, adminEmail: autor.adminEmail, accion, detalle } });
}

/**
 * La fila de auditoría de una acción sobre una empresa, escrita DENTRO de la misma transacción que el cambio (ADR-012 §5): un cambio de plataforma sin su fila no puede
 * existir. `tx` es el cliente de esa transacción. El `detalle` nunca lleva tokens, hashes ni secretos.
 */
export async function auditarEnTransaccion(
  tx: Prisma.TransactionClient,
  autor: Autor,
  accion: AccionDePlataforma,
  empresaAfectadaId: string,
  detalle?: Record<string, string | number | boolean>,
): Promise<void> {
  await tx.auditoriaPlataforma.create({ data: { adminId: autor.adminId, adminEmail: autor.adminEmail, accion, empresaAfectadaId, detalle } });
}
