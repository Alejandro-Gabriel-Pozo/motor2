import "server-only";
import { dbPlataforma } from "../db";

/** Acciones de la propia consola que se anotan en la auditoría de plataforma. Las que actúan sobre una empresa se suman con las etapas siguientes. */
export type AccionDePlataforma = "ingreso" | "cierre-de-sesion" | "segundo-factor-fallido" | "bloqueo-por-fallos";

interface Autor {
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
