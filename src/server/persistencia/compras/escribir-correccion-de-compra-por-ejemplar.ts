import "server-only";
import type { Prisma } from "@prisma/client";
import type { LineaCorregida } from "@/core/compras/public";
import type { LineaDeReversion } from "@/core/compras/public";
import { escribirContraAsiento, type FilaDeContraAsiento } from "@/server/persistencia/movimientos/escribir-contra-asiento";
import { escribirLineasDeMovimientoStock, escribirOperacionDeStock } from "@/server/persistencia/movimientos/escribir-movimiento-de-stock";

/**
 * Escritura de la CORRECCIÓN DE IMPORTES de una compra por ejemplar (etapa C0; mismo contrato que `escribir-anulacion-de-compra.ts`: `tx` obligatorio, sin reglas de negocio). En este orden, todo dentro de la transacción
 * del caso de uso:
 *  1. el CONTRA-ASIENTO de la compra original (la misma `escribirContraAsiento` de las anulaciones: una AJUSTE con una línea inversa por línea) y la marca `anuladaEn`/`anuladaPorId`/`motivoAnulacion` en la original,
 *     que de ahí en más queda «reemplazada» (nunca se edita en nada más: el Kardex solo agrega);
 *  2. la `Operacion` COMPRA del EJEMPLAR NUEVO, con la misma fecha, proveedor y N.º de factura (la original ya está anulada, así que el índice único del número entre vigentes no choca), la clave y la huella de I3, el motivo elegido
 *     del catálogo y el enlace `reemplazaAOperacionId` a la original;
 *  3. sus líneas de Kardex: mismas cantidades, productos, secciones y lotes que la original, con los importes corregidos.
 * El contra-asiento va PRIMERO a propósito: libera el número de factura antes de insertar el ejemplar. El mensaje de resultado de I3 y la auditoría los registra el caso de uso después.
 */
export interface CorreccionPorEjemplarAEscribir {
  compraAnteriorId: string;
  sucursalId: string;
  usuarioId: string;
  /** El mismo instante para la fecha del contra-asiento y la marca `anuladaEn`. */
  ahora: Date;
  /** La fecha, el proveedor, el número y el detalle de la original, que el ejemplar nuevo conserva. */
  fecha: Date;
  proveedorId: string | null;
  nroFactura: string | null;
  detalleLibre: string | null;
  motivoId: string;
  /** El texto del motivo (nombre del catálogo más el detalle, hasta 200): lo que queda en la original anulada. */
  motivoTexto: string;
  detalleDeLaReversion: string;
  claveIdempotencia: string;
  payloadHash: string;
  reversion: readonly LineaDeReversion[];
  lineas: readonly LineaCorregida[];
}

export async function escribirCorreccionDeCompraPorEjemplar(tx: Prisma.TransactionClient, c: CorreccionPorEjemplarAEscribir): Promise<{ compraNuevaId: string; reversionId: string }> {
  const filas: FilaDeContraAsiento[] = c.reversion.map((l) => ({
    productoId: l.productoId,
    seccionId: l.seccionId,
    proceso: "AJUSTE",
    cantidad: l.cantidad,
    loteVencimiento: l.loteVencimiento,
    detalle: l.detalle,
    precioTotal: l.precioTotal,
    precioPorUnidadStock: l.precioPorUnidadStock,
  }));
  const { reversionId } = await escribirContraAsiento(tx, {
    operacionAnuladaId: c.compraAnteriorId,
    sucursalId: c.sucursalId,
    usuarioId: c.usuarioId,
    ahora: c.ahora,
    detalleLibre: c.detalleDeLaReversion,
    filas,
    motivoAnulacion: c.motivoTexto,
  });

  const nueva = await escribirOperacionDeStock(tx, {
    sucursalId: c.sucursalId,
    proceso: "COMPRA",
    fecha: c.fecha,
    proveedorId: c.proveedorId,
    nroFactura: c.nroFactura,
    seccionDestinoId: null,
    motivoId: c.motivoId,
    destinoId: null,
    detalleLibre: c.detalleLibre,
    usuarioId: c.usuarioId,
    claveIdempotencia: c.claveIdempotencia,
    payloadHash: c.payloadHash,
    reemplazaAOperacionId: c.compraAnteriorId,
  });

  await escribirLineasDeMovimientoStock(
    tx,
    c.lineas.map((l) => ({
      operacionId: nueva.id,
      productoId: l.productoId,
      seccionId: l.seccionId,
      proceso: "COMPRA" as const,
      cantidad: l.cantidad,
      loteVencimiento: l.loteVencimiento,
      detalle: l.detalle,
      precioTotal: l.precioTotal,
      precioPorUnidadStock: l.precioPorUnidadStock,
    }))
  );
  return { compraNuevaId: nueva.id, reversionId };
}
