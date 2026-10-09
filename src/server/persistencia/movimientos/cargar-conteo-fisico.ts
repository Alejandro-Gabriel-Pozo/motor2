import "server-only";
import type { EstadoConteo, Prisma } from "@prisma/client";

/**
 * Carga de un conteo físico por id (Task #41, Fase M, M13e2 — docs/arquitectura-casos-de-uso-2026-09-27.md). Es el MISMO
 * `tx.conteoFisico.findUnique({ where: { id: conteoId } })` que hoy hacen, cada uno por su lado, `resolverConteoPendiente` y
 * `cancelarConteoFisico` (`src/server/actions/movimientos/conteo-fisico.ts`). Solo los campos que esos dos casos de uso efectivamente
 * leen: `id`/`sucursalId` (dueño del conteo), `estado` (la transición permitida), `productoId`/`seccionId`/`loteVencimiento` (para
 * recalcular el saldo), `conteoReal`/`diferencia` (el ajuste original) y `detalle` (se concatena en el mensaje de cierre).
 *
 * `tx: Prisma.TransactionClient` obligatorio, como todo `server/persistencia/`: sin reglas de negocio acá — si el conteo no existe o es
 * de otra sucursal, quien llama decide el mensaje.
 */
export interface ConteoFisicoCargado {
  id: string;
  sucursalId: string;
  estado: EstadoConteo;
  productoId: string;
  seccionId: string;
  loteVencimiento: Date | null;
  conteoReal: Prisma.Decimal;
  diferencia: Prisma.Decimal;
  detalle: string | null;
  /** Para la descripción de la fila de auditoría (S-04/S-09: cancelar y resolver con ajuste se auditan); el nombre de la sucursal viene del actor. */
  productoNombre: string;
}

export async function cargarConteoFisico(tx: Prisma.TransactionClient, conteoId: string): Promise<ConteoFisicoCargado | null> {
  const conteo = await tx.conteoFisico.findUnique({
    where: { id: conteoId },
    select: {
      id: true,
      sucursalId: true,
      estado: true,
      productoId: true,
      seccionId: true,
      loteVencimiento: true,
      conteoReal: true,
      diferencia: true,
      detalle: true,
      producto: { select: { nombre: true } },
    },
  });
  if (!conteo) return null;
  const { producto, ...resto } = conteo;
  return { ...resto, productoNombre: producto.nombre };
}
