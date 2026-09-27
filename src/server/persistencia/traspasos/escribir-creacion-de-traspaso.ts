import "server-only";
import type { Prisma } from "@prisma/client";
import { escribirSalidaDeTraspaso } from "./escribir-aprobacion-de-traspaso";

/**
 * Escrituras de la CREACIÓN de un traspaso (Task #41, Fase M11c — docs/arquitectura-casos-de-uso-2026-09-27.md; mismo contrato que
 * `cargar-traspaso.ts`: `tx` obligatorio, sin reglas de negocio). Son EXACTAMENTE lo que antes escribían en línea
 * `crearSolicitudTransferencia` y `crearEnvioDirectoTransferencia` (src/server/actions/traspasos/traspasos.ts), en el mismo orden.
 */

/** Lo común a los dos sentidos: las dos puntas, el producto, la cantidad ya validada, quién lo crea y el detalle ya normalizado. */
interface TraspasoACrear {
  origenSucursalId: string;
  destinoSucursalId: string;
  productoId: string;
  /** Positiva, ya validada contra los decimales de la unidad de stock. */
  cantidad: number;
  usuarioId: string;
  detalle: string | null;
}

/** PULL: el traspaso SOLICITADO, iniciado por Destino, con la sección de destino elegida. No toca stock. */
export async function escribirSolicitudDeTraspaso(
  tx: Prisma.TransactionClient,
  t: TraspasoACrear & { seccionDestinoId: string }
): Promise<{ traspasoId: string }> {
  const traspaso = await tx.traspasoSucursal.create({
    data: {
      origenSucursalId: t.origenSucursalId,
      destinoSucursalId: t.destinoSucursalId,
      productoId: t.productoId,
      cantidad: t.cantidad,
      seccionDestinoId: t.seccionDestinoId,
      iniciadoPor: "DESTINO",
      estado: "SOLICITADA",
      creadoPorId: t.usuarioId,
      detalle: t.detalle,
    },
  });
  return { traspasoId: traspaso.id };
}

/**
 * PUSH: el traspaso ENVIADO (iniciado por Origen, ya decidido por Origen al crearse) y, a continuación, su SALIDA en el Kardex de Origen
 * (`escribirSalidaDeTraspaso`, la misma que escribe la aprobación de una solicitud).
 */
export async function escribirEnvioDirectoDeTraspaso(
  tx: Prisma.TransactionClient,
  t: TraspasoACrear & {
    seccionOrigenId: string;
    /** `detalle` de la línea de Kardex («Transferencia a sucursal "…".»). */
    detalleSalida: string;
    /** El mismo instante para la decisión de Origen y la fecha de la Operación. */
    ahora: Date;
  }
): Promise<{ traspasoId: string; operacionId: string }> {
  const traspaso = await tx.traspasoSucursal.create({
    data: {
      origenSucursalId: t.origenSucursalId,
      destinoSucursalId: t.destinoSucursalId,
      productoId: t.productoId,
      cantidad: t.cantidad,
      seccionOrigenId: t.seccionOrigenId,
      iniciadoPor: "ORIGEN",
      estado: "ENVIADA",
      creadoPorId: t.usuarioId,
      detalle: t.detalle,
      fechaDecisionOrigen: t.ahora,
      decididoPorOrigenId: t.usuarioId,
    },
  });

  const { operacionId } = await escribirSalidaDeTraspaso(tx, {
    traspasoId: traspaso.id,
    productoId: t.productoId,
    sucursalId: t.origenSucursalId,
    usuarioId: t.usuarioId,
    seccionOrigenId: t.seccionOrigenId,
    cantidad: t.cantidad,
    detalle: t.detalleSalida,
    ahora: t.ahora,
  });

  return { traspasoId: traspaso.id, operacionId };
}
