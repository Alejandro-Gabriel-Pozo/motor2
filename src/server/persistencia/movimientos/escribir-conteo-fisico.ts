import "server-only";
import type { AccionConteo, EstadoConteo, Prisma, PrismaClient } from "@prisma/client";

/**
 * Escritura de `ConteoFisico` (Task #41, Fase M, M13e1 — docs/arquitectura-casos-de-uso-2026-09-27.md; mismo contrato que el resto de
 * `server/persistencia/`: `tx` obligatorio, sin reglas de negocio). Es el MISMO `tx.conteoFisico.create({ data: {...} })` que antes
 * hacía en línea `registrarConteoConContexto` (`src/server/actions/movimientos/conteo-fisico.ts`), los mismos 11 campos.
 */
export interface ConteoFisicoAEscribir {
  sucursalId: string;
  fecha: Date;
  productoId: string;
  seccionId: string;
  loteVencimiento: Date | null;
  saldoSistema: number;
  conteoReal: number;
  diferencia: number;
  accion: AccionConteo;
  estado: EstadoConteo;
  detalle: string | null;
  usuarioId: string;
  claveIdempotencia: string | null;
  payloadHash: string | null;
  resultadoMensaje: string | null;
}

/** `null` si ningún conteo tiene esa clave todavía (I3). */
export async function cargarConteoFisicoPorClave(
  db: Prisma.TransactionClient,
  claveIdempotencia: string
): Promise<{ payloadHash: string | null; resultadoMensaje: string | null } | null> {
  return db.conteoFisico.findUnique({ where: { claveIdempotencia }, select: { payloadHash: true, resultadoMensaje: true } });
}

/** El ganador de una carrera por la misma clave, leído FUERA de la transacción que chocó (I3). */
export async function cargarGanadorDelConteo(
  db: Prisma.TransactionClient | PrismaClient,
  claveIdempotencia: string
): Promise<{ payloadHash: string | null; resultadoMensaje: string | null } | null> {
  return db.conteoFisico.findUnique({ where: { claveIdempotencia }, select: { payloadHash: true, resultadoMensaje: true } });
}

export async function escribirConteoFisico(tx: Prisma.TransactionClient, datos: ConteoFisicoAEscribir): Promise<{ id: string }> {
  const conteo = await tx.conteoFisico.create({ data: { ...datos } });
  return { id: conteo.id };
}

/**
 * Cierre de un conteo (Task #41, Fase M, M13e2 — docs/arquitectura-casos-de-uso-2026-09-27.md). Es el MISMO
 * `tx.conteoFisico.update({ where: { id }, data: { estado, detalle } })` que hacen hoy, en distintas variantes (4 llamadas en total),
 * `resolverConteoPendiente` y `cancelarConteoFisico` (`src/server/actions/movimientos/conteo-fisico.ts`) para pasar el conteo a
 * RESUELTO (sin ajuste, con ajuste) o CANCELADO.
 */
export interface EstadoDeConteoAActualizar {
  estado: EstadoConteo;
  detalle: string | null;
}

export async function actualizarEstadoDeConteo(tx: Prisma.TransactionClient, conteoId: string, datos: EstadoDeConteoAActualizar): Promise<void> {
  await tx.conteoFisico.update({ where: { id: conteoId }, data: { estado: datos.estado, detalle: datos.detalle } });
}
