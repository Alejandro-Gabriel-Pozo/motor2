import "server-only";
import type { Prisma } from "@prisma/client";

/**
 * Escritura de la `Operacion` (encabezado) de UNA venta (Pureza Fase 4, tramo A: PR 4A-1, paso 4A.4). Es EXACTAMENTE el `tx.operacion.create` que antes hacía en
 * línea `registrarVentaEnTx`; mismo contrato que el resto de `server/persistencia/`: `tx` obligatorio, sin reglas de negocio (qué guardar lo decide el caso de uso).
 *
 * Cada venta individual del lote es su propia `Operacion` (para poder reconstruir «qué consumió esta venta puntual»). Las filas del Kardex (CONSUMO,
 * LIQUIDACION_CONSIGNACION y VENTA) se escriben DESPUÉS, todas juntas, con `escribirLineasDeMovimientoStock`: de ese orden (las Operaciones una por una, el `createMany`
 * al final) dependen la clave I3 en la primera Operación, el enlace del POS con su consumo y la reversión de la anulación.
 */
export interface OperacionDeVentaAEscribir {
  sucursalId: string;
  fecha: Date;
  proveedorId: string | null;
  clienteId: string | null;
  promoCuentaId: string | null;
  nroFactura: string | null;
  detalleLibre: string | null;
  usuarioId: string;
  /** Solo la PRIMERA operación del lote lleva la clave y el hash del intento (I3). */
  claveIdempotencia: string | null;
  payloadHash: string | null;
}

export async function escribirOperacionDeVenta(tx: Prisma.TransactionClient, datos: OperacionDeVentaAEscribir): Promise<{ id: string }> {
  const operacion = await tx.operacion.create({ data: { ...datos, proceso: "VENTA" } });
  return { id: operacion.id };
}
