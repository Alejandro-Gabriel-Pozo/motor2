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
  | "aviso-de-activacion"
  | "modulo-activado"
  | "modulo-desactivado";

export interface Autor {
  adminId: string;
  adminEmail: string;
}

type Detalle = Record<string, string | number | boolean>;

/**
 * Los datos de una fila de auditoría de plataforma. Prisma 7 rechaza un valor `undefined` EXPLÍCITO en `data` (`detalle: undefined` hizo fallar el ingreso de la consola en el primer
 * CI que la corrió): una clave sin valor simplemente no se incluye.
 */
export function datosDeAuditoria(autor: Autor, accion: AccionDePlataforma, empresaAfectadaId?: string, detalle?: Detalle) {
  return {
    adminId: autor.adminId,
    adminEmail: autor.adminEmail,
    accion,
    ...(empresaAfectadaId !== undefined ? { empresaAfectadaId } : {}),
    ...(detalle !== undefined ? { detalle } : {}),
  };
}

/**
 * Anota qué hizo un administrador, con él como autor (ADR-012 §7). El `detalle` nunca lleva códigos, tokens ni secretos: solo hechos
 * (por ejemplo, qué factor se usó).
 */
export async function auditarAccionDePlataforma(autor: Autor, accion: AccionDePlataforma, detalle?: Detalle): Promise<void> {
  await dbPlataforma().auditoriaPlataforma.create({ data: datosDeAuditoria(autor, accion, undefined, detalle) });
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
  detalle?: Detalle,
): Promise<void> {
  await tx.auditoriaPlataforma.create({ data: datosDeAuditoria(autor, accion, empresaAfectadaId, detalle) });
}
