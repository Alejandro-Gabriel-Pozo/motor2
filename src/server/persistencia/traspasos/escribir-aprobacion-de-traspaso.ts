import "server-only";
import type { EstadoTraspaso, Prisma } from "@prisma/client";

/**
 * Escritura de la APROBACIÓN de una solicitud de traspaso por Origen (Task #41, Fase M11a; mismo contrato que `cargar-traspaso.ts`:
 * `tx` obligatorio, sin reglas de negocio). Es EXACTAMENTE lo que antes escribía en línea `aprobarYEnviarTransferencia`
 * (src/server/actions/traspasos/traspasos.ts, vía su helper `escribirMovimientoTraspaso`), en el mismo orden:
 *  1. la `Operacion` TRANSFERENCIA_SALIDA_SUCURSAL de ESTA sucursal (sin clave de idempotencia: la aprobación nunca tuvo I3);
 *  2. su única línea de Kardex: la cantidad en NEGATIVO en la sección de origen, a precio 0, atada al traspaso;
 *  3. el traspaso: sección de origen, estado nuevo (ENVIADA), fecha y autor de la decisión de Origen.
 */
export interface AprobacionDeTraspasoAEscribir {
  traspasoId: string;
  productoId: string;
  /** La sucursal que aprueba (Origen) y quien lo hace. */
  sucursalId: string;
  usuarioId: string;
  seccionOrigenId: string;
  /** Positiva: se escribe en negativo (sale del stock). */
  cantidad: number;
  /** `detalle` de la línea de Kardex («Transferencia a sucursal "…".»). */
  detalle: string;
  estadoNuevo: EstadoTraspaso;
  /** El mismo instante para la fecha de la Operación y la de la decisión de Origen. */
  ahora: Date;
}

export async function escribirAprobacionDeTraspaso(tx: Prisma.TransactionClient, a: AprobacionDeTraspasoAEscribir): Promise<{ operacionId: string }> {
  const proceso = "TRANSFERENCIA_SALIDA_SUCURSAL";
  const operacion = await tx.operacion.create({
    data: {
      sucursalId: a.sucursalId,
      proceso,
      fecha: a.ahora,
      usuarioId: a.usuarioId,
      claveIdempotencia: null,
      payloadHash: null,
    },
  });
  await tx.movimientoStock.create({
    data: {
      operacionId: operacion.id,
      productoId: a.productoId,
      seccionId: a.seccionOrigenId,
      proceso,
      cantidad: -a.cantidad,
      detalle: a.detalle,
      precioTotal: 0,
      precioPorUnidadStock: 0,
      traspasoSucursalId: a.traspasoId,
    },
  });

  await tx.traspasoSucursal.update({
    where: { id: a.traspasoId },
    data: { seccionOrigenId: a.seccionOrigenId, estado: a.estadoNuevo, fechaDecisionOrigen: a.ahora, decididoPorOrigenId: a.usuarioId },
  });

  return { operacionId: operacion.id };
}
