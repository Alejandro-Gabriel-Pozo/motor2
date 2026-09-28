import "server-only";
import type { AccionConteo, EstadoConteo, Prisma } from "@prisma/client";

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
}

export async function escribirConteoFisico(tx: Prisma.TransactionClient, datos: ConteoFisicoAEscribir): Promise<{ id: string }> {
  const conteo = await tx.conteoFisico.create({ data: { ...datos } });
  return { id: conteo.id };
}
