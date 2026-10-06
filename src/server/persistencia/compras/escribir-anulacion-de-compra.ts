import "server-only";
import type { Prisma } from "@prisma/client";
import type { LineaDeReversion } from "@/core/compras/public";

/**
 * Escritura de la ANULACIÓN de una compra (Task #41, Fase M; mismo contrato que `cargar-compra-para-anular.ts`: `tx` obligatorio, sin
 * reglas de negocio). Es EXACTAMENTE lo que antes escribía en línea `anularCompra`, en el mismo orden:
 *  1. la `Operacion` AJUSTE nueva (el contra-asiento), con la clave y el hash de idempotencia si los hay;
 *  2. una línea de Kardex por cada línea de `reversion` (ya calculada por `evaluarAnulacion`);
 *  3. la marca `anuladaEn`/`anuladaPorId` en la compra original (que nunca se edita en nada más: el Kardex es append-only).
 *
 * El mensaje de resultado para la idempotencia NO se escribe acá: lo registra el caso de uso con `registrarResultadoIdempotente`
 * (core/movimientos/idempotencia.ts), después de la auditoría — el mismo orden que antes.
 */
export interface AnulacionAEscribir {
  compraId: string;
  sucursalId: string;
  usuarioId: string;
  /** El mismo instante para la fecha del contra-asiento y la marca `anuladaEn`. */
  ahora: Date;
  /** `detalleLibre` del contra-asiento (`detalleReversionDeCompra`, core/movimientos/anulaciones.ts). */
  detalleLibre: string;
  claveIdempotencia: string | null;
  payloadHash: string | null;
  reversion: readonly LineaDeReversion[];
}

export async function escribirAnulacionDeCompra(
  tx: Prisma.TransactionClient,
  anulacion: AnulacionAEscribir
): Promise<{ reversionId: string; movimientos: number }> {
  const reversion = await tx.operacion.create({
    data: {
      sucursalId: anulacion.sucursalId,
      proceso: "AJUSTE",
      fecha: anulacion.ahora,
      detalleLibre: anulacion.detalleLibre,
      usuarioId: anulacion.usuarioId,
      claveIdempotencia: anulacion.claveIdempotencia,
      payloadHash: anulacion.payloadHash,
    },
  });

  const filas: Prisma.MovimientoStockCreateManyInput[] = anulacion.reversion.map((l) => ({
    operacionId: reversion.id,
    productoId: l.productoId,
    seccionId: l.seccionId,
    proceso: "AJUSTE",
    cantidad: l.cantidad,
    loteVencimiento: l.loteVencimiento,
    detalle: l.detalle,
    precioTotal: l.precioTotal,
    precioPorUnidadStock: l.precioPorUnidadStock,
  }));
  await tx.movimientoStock.createMany({ data: filas });

  await tx.operacion.update({ where: { id: anulacion.compraId }, data: { anuladaEn: anulacion.ahora, anuladaPorId: anulacion.usuarioId } });

  return { reversionId: reversion.id, movimientos: filas.length };
}
