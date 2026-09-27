import "server-only";
import type { EstadoTraspaso, Prisma } from "@prisma/client";

/**
 * Escrituras que hacen ENTRAR el stock de un traspaso a un Kardex local (Task #41, Fase M11b — docs/arquitectura-casos-de-uso-2026-09-27.md;
 * mismo contrato que `cargar-traspaso.ts`: `tx` obligatorio, sin reglas de negocio — el estado nuevo lo decide `guardTransicionTraspaso`).
 * Son EXACTAMENTE lo que antes escribían en línea `aceptarTransferencia` y `confirmarReingresoTransferencia`
 * (src/server/actions/traspasos/traspasos.ts, vía su helper `escribirMovimientoTraspaso`), en el mismo orden:
 *  1. la `Operacion` de ESTA sucursal, con la clave I3 y su hash si vino clave (`null` si no);
 *  2. su única línea de Kardex: la cantidad en POSITIVO en la sección dada, a precio 0, atada al traspaso;
 *  3. el traspaso: estado nuevo y los campos propios de cada paso.
 * El `resultadoMensaje` de la clave I3 lo escribe después el caso de uso (`registrarResultadoIdempotente`), igual que antes.
 */

export interface EntradaDeStockAEscribir {
  traspasoId: string;
  productoId: string;
  /** La sucursal que registra la entrada y quien lo hace. */
  sucursalId: string;
  usuarioId: string;
  seccionId: string;
  /** Positiva: se suma al stock. */
  cantidad: number;
  /** `detalle` de la línea de Kardex. */
  detalle: string;
  estadoNuevo: EstadoTraspaso;
  ahora: Date;
  /** I3: clave y hash del payload, o `null` si no vino clave. */
  idempotencia: { claveIdempotencia: string; payloadHash: string } | null;
}

async function escribirOperacionDeEntrada(
  tx: Prisma.TransactionClient,
  proceso: "TRANSFERENCIA_ENTRADA_SUCURSAL" | "REINGRESO_TRANSFERENCIA_SUCURSAL",
  e: EntradaDeStockAEscribir
): Promise<string> {
  const operacion = await tx.operacion.create({
    data: {
      sucursalId: e.sucursalId,
      proceso,
      fecha: e.ahora,
      usuarioId: e.usuarioId,
      claveIdempotencia: e.idempotencia?.claveIdempotencia ?? null,
      payloadHash: e.idempotencia?.payloadHash ?? null,
    },
  });
  await tx.movimientoStock.create({
    data: {
      operacionId: operacion.id,
      productoId: e.productoId,
      seccionId: e.seccionId,
      proceso,
      cantidad: e.cantidad,
      detalle: e.detalle,
      precioTotal: 0,
      precioPorUnidadStock: 0,
      traspasoSucursalId: e.traspasoId,
    },
  });
  return operacion.id;
}

/** Destino acepta un envío: ENTRADA en la sección de destino + traspaso con sección de destino, estado nuevo (ACEPTADA) y decisión de Destino. */
export async function escribirAceptacionDeTraspaso(tx: Prisma.TransactionClient, e: EntradaDeStockAEscribir): Promise<{ operacionId: string }> {
  const operacionId = await escribirOperacionDeEntrada(tx, "TRANSFERENCIA_ENTRADA_SUCURSAL", e);
  await tx.traspasoSucursal.update({
    where: { id: e.traspasoId },
    data: { seccionDestinoId: e.seccionId, estado: e.estadoNuevo, fechaDecisionDestino: e.ahora, decididoPorDestinoId: e.usuarioId },
  });
  return { operacionId };
}

/** Origen confirma el reingreso: REINGRESO en la sección de origen + traspaso con estado nuevo (CERRADA) y cierre (fecha y autor). */
export async function escribirReingresoDeTraspaso(tx: Prisma.TransactionClient, e: EntradaDeStockAEscribir): Promise<{ operacionId: string }> {
  const operacionId = await escribirOperacionDeEntrada(tx, "REINGRESO_TRANSFERENCIA_SUCURSAL", e);
  await tx.traspasoSucursal.update({
    where: { id: e.traspasoId },
    data: { estado: e.estadoNuevo, fechaCierre: e.ahora, cerradoPorId: e.usuarioId },
  });
  return { operacionId };
}
