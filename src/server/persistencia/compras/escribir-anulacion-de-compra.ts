import "server-only";
import type { Prisma } from "@prisma/client";
import type { LineaDeReversion } from "@/core/compras/public";
import { escribirContraAsiento, type FilaDeContraAsiento } from "@/server/persistencia/movimientos/escribir-contra-asiento";

/**
 * Escritura de la ANULACIÓN de una compra (Task #41, Fase M; mismo contrato que `cargar-compra-para-anular.ts`: `tx` obligatorio, sin
 * reglas de negocio). Es EXACTAMENTE lo que antes escribía en línea `anularCompra`, en el mismo orden:
 *  1. la `Operacion` AJUSTE nueva (el contra-asiento), con la clave y el hash de idempotencia si los hay;
 *  2. una línea de Kardex por cada línea de `reversion` (ya calculada por `evaluarAnulacion`);
 *  3. la marca `anuladaEn`/`anuladaPorId` en la compra original (que nunca se edita en nada más: el Kardex es append-only).
 * Desde la pieza 5.4 (A5) esos tres pasos los hace `escribirContraAsiento` (`server/persistencia/movimientos/escribir-contra-asiento.ts`, compartido
 * con la anulación de venta); acá queda armar las filas de la compra (AJUSTE, sin `cantidadExacta`) y pasar SIEMPRE la clave y el hash (con `null` si no hay).
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
  const filas: FilaDeContraAsiento[] = anulacion.reversion.map((l) => ({
    productoId: l.productoId,
    seccionId: l.seccionId,
    proceso: "AJUSTE",
    cantidad: l.cantidad,
    loteVencimiento: l.loteVencimiento,
    detalle: l.detalle,
    precioTotal: l.precioTotal,
    precioPorUnidadStock: l.precioPorUnidadStock,
  }));
  return escribirContraAsiento(tx, {
    operacionAnuladaId: anulacion.compraId,
    sucursalId: anulacion.sucursalId,
    usuarioId: anulacion.usuarioId,
    ahora: anulacion.ahora,
    detalleLibre: anulacion.detalleLibre,
    idempotencia: { claveIdempotencia: anulacion.claveIdempotencia, payloadHash: anulacion.payloadHash },
    filas,
  });
}
