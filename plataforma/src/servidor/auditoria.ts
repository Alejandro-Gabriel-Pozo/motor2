import "server-only";
import type { Prisma } from "@prisma/client";
import { dbDeIdentidad } from "../db";

/**
 * Acciones de la propia consola que se anotan en la auditoría de plataforma. Dos familias que el compilador mantiene separadas (ADR-025): las de IDENTIDAD (ingreso, cierre de sesión,
 * factor fallido, bloqueo) se anotan en la base de la instalación PRINCIPAL, donde viven los administradores; las que actúan SOBRE UNA EMPRESA llevan `empresaAfectadaId` y se anotan en la
 * base de ESA empresa, dentro de la misma transacción que el cambio (ADR-012 §5).
 */
export type AccionDeIdentidad = "ingreso" | "cierre-de-sesion" | "segundo-factor-fallido" | "bloqueo-por-fallos";

export type AccionSobreEmpresa =
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

export type AccionDePlataforma = AccionDeIdentidad | AccionSobreEmpresa;

export interface Autor {
  adminId: string;
  adminEmail: string;
}

/**
 * Quien actúa SOBRE una empresa: el administrador y la INSTALACIÓN en la que opera (ADR-025). Toda fila de auditoría de una acción sobre una empresa lleva el id de la instalación en su
 * `detalle`: así, si alguna vez una operación cayera en la base equivocada, el desacople se ve en la propia fila (la base de la empresa dice en qué instalación se creyó operando).
 */
export interface AutorEnInstalacion extends Autor {
  instalacionId: string;
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
export async function auditarAccionDePlataforma(autor: Autor, accion: AccionDeIdentidad, detalle?: Detalle): Promise<void> {
  await dbDeIdentidad().auditoriaPlataforma.create({ data: datosDeAuditoria(autor, accion, undefined, detalle) });
}

/**
 * La fila de auditoría de una acción sobre una empresa, escrita DENTRO de la misma transacción que el cambio (ADR-012 §5): un cambio de plataforma sin su fila no puede
 * existir. `tx` es el cliente de esa transacción. El `detalle` nunca lleva tokens, hashes ni secretos.
 */
export async function auditarEnTransaccion(
  tx: Prisma.TransactionClient,
  autor: AutorEnInstalacion,
  accion: AccionSobreEmpresa,
  empresaAfectadaId: string,
  detalle?: Detalle,
): Promise<void> {
  await tx.auditoriaPlataforma.create({ data: datosDeAuditoria(autor, accion, empresaAfectadaId, { ...detalle, instalacion: autor.instalacionId }) });
}
