import "server-only";
import type { Prisma, Proceso } from "@prisma/client";

/**
 * Escrituras de Operacion (encabezado) + MovimientoStock[] (líneas) del motor genérico `registrarMovimiento` (Task #41, Fase M, M13b —
 * docs/arquitectura-casos-de-uso-2026-09-27.md; mismo contrato que el resto de `server/persistencia/`: `tx` obligatorio, sin reglas de
 * negocio). Son EXACTAMENTE los dos `tx.operacion.create`/`tx.movimientoStock.createMany` que antes hacía en línea el caso de uso
 * (`casos-de-uso/registrar-movimiento.ts`).
 *
 * DOS funciones separadas a propósito, no una sola que reciba las líneas ya armadas: el caso de uso necesita el `id` de la Operacion
 * ANTES de armar las filas (cada fila lleva `operacionId`) y, para Producción, arma esas filas leyendo `obtenerProducto` de cada insumo
 * consumido DESPUÉS del INSERT de la Operacion — fusionar ambas llamadas cambiaría ese orden.
 */

/** Los 12 campos del `tx.operacion.create` de `registrarMovimiento`. `proceso` usa el enum de dominio `Proceso` (no un tipo interno de Prisma). */
export interface OperacionDeStockAEscribir {
  sucursalId: string;
  proceso: Proceso;
  fecha: Date;
  proveedorId: string | null;
  nroFactura: string | null;
  seccionDestinoId: string | null;
  motivoId: string | null;
  destinoId: string | null;
  detalleLibre: string | null;
  usuarioId: string;
  claveIdempotencia: string | null;
  payloadHash: string | null;
}

export async function escribirOperacionDeStock(tx: Prisma.TransactionClient, datos: OperacionDeStockAEscribir): Promise<{ id: string }> {
  const operacion = await tx.operacion.create({ data: { ...datos } });
  return { id: operacion.id };
}

export async function escribirLineasDeMovimientoStock(
  tx: Prisma.TransactionClient,
  filas: Prisma.MovimientoStockCreateManyInput[]
): Promise<{ movimientos: number }> {
  await tx.movimientoStock.createMany({ data: filas });
  return { movimientos: filas.length };
}
