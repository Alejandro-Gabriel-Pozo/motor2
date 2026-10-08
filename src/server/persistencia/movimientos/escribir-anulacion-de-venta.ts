import "server-only";
import type { Prisma } from "@prisma/client";
import type { LineaDeReversionDeVenta } from "@/core/movimientos/public";
import { escribirContraAsiento, type FilaDeContraAsiento } from "./escribir-contra-asiento";

/**
 * Escritura de la ANULACIÓN de UNA Operación VENTA (Task #41, Fase M; mismo contrato que `cargar-venta-para-anular.ts`: `tx`
 * obligatorio, sin reglas de negocio). Es EXACTAMENTE lo que antes escribía en línea `anularVenta` por cada Operación a anular (la pedida
 * y cada hermana de promo), en el mismo orden:
 *  1. la `Operacion` AJUSTE nueva (el contra-asiento);
 *  2. una línea de Kardex por cada línea de `reversion` (ya calculada por `construirReversionDeVenta`);
 *  3. la marca `anuladaEn`/`anuladaPorId` en la venta original (que nunca se edita en nada más: el Kardex es append-only).
 * Desde la pieza 5.4 (A5) esos tres pasos los hace `escribirContraAsiento` (`escribir-contra-asiento.ts`, compartido con la anulación de compra); acá
 * queda armar las filas de la venta (proceso y `cantidadExacta` de cada línea) y NO pasar claves de idempotencia.
 *
 * La fila de auditoría NO se escribe acá: la registra el caso de uso con `registrarCambioAuditado` (core/permisos/auditoria.ts) justo
 * después de cada llamada — el mismo orden que antes.
 */
export interface AnulacionDeVentaAEscribir {
  ventaId: string;
  sucursalId: string;
  usuarioId: string;
  /** El mismo instante para la fecha del contra-asiento y la marca `anuladaEn` (y compartido por todas las hermanas de una promo). */
  ahora: Date;
  /** `detalleLibre` del contra-asiento (`detalleReversionDeVenta`, core/movimientos/anulaciones.ts). */
  detalleLibre: string;
  reversion: readonly LineaDeReversionDeVenta[];
}

export async function escribirAnulacionDeVenta(
  tx: Prisma.TransactionClient,
  anulacion: AnulacionDeVentaAEscribir
): Promise<{ reversionId: string; movimientos: number }> {
  const filas: FilaDeContraAsiento[] = anulacion.reversion.map((l) => ({
    productoId: l.productoId,
    seccionId: l.seccionId,
    proceso: l.proceso,
    cantidad: l.cantidad,
    cantidadExacta: l.cantidadExacta,
    loteVencimiento: l.loteVencimiento,
    detalle: l.detalle,
    precioTotal: l.precioTotal,
    precioPorUnidadStock: l.precioPorUnidadStock,
  }));
  // Sin `idempotencia`: la anulación de una venta no lleva clave I3, y el `create` de la `Operacion` no manda esas claves ni con `null`.
  return escribirContraAsiento(tx, {
    operacionAnuladaId: anulacion.ventaId,
    sucursalId: anulacion.sucursalId,
    usuarioId: anulacion.usuarioId,
    ahora: anulacion.ahora,
    detalleLibre: anulacion.detalleLibre,
    filas,
  });
}
