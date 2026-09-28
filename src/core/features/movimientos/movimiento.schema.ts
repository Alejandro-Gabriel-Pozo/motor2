import type { Proceso } from "@prisma/client";
import type { ResultadoCaso } from "@/core/resultado-caso";

/**
 * Tipos del motor genérico de movimientos (Task #41, Fase M, M13a — docs/arquitectura-casos-de-uso-2026-09-27.md). Mudados TAL CUAL
 * desde `src/server/actions/movimientos/movimientos.ts` (que los reexporta con el mismo nombre, para no romper a nadie que ya los
 * importaba desde ahí) — nada de su forma cambia en este sub-paso.
 */

/** Procesos que pasan por este motor genérico — Venta (registrarVenta), Control (registrarConteoFisico, conteo-fisico.ts), Reclasificación (reclasificarStock, reclasificacion.ts) y los 3 pasos de Traspasos entre sucursales (traspasos.ts) tienen cada uno su propio camino, mismo criterio que Apps Script (armarPreviaVentaDesdeItems_/_registrarConteoFisicoSinRecalculo_/dividirClasificacionStock_/escribirMovimientoTransferenciaSucursal_ nunca pasan por armarRegistroMovimiento_). LIQUIDACION_CONSIGNACION nunca la elige un usuario. */
export type ProcesoGenerico = Exclude<
  Proceso,
  "VENTA" | "CONTROL" | "LIQUIDACION_CONSIGNACION" | "RECLASIFICACION" | "TRANSFERENCIA_SALIDA_SUCURSAL" | "TRANSFERENCIA_ENTRADA_SUCURSAL" | "REINGRESO_TRANSFERENCIA_SUCURSAL"
>;

export interface ItemMovimientoInput {
  productoId: string;
  /** Ajuste: delta YA con signo (puede ser negativo, o 0 si permiteCero). Cualquier otro proceso: magnitud positiva. */
  cantidad: number;
  loteVencimiento?: Date | null;
  /** Compra/Devolución a Proveedor: importe real de la factura para ESTA línea (no un precio unitario a calcular a mano). */
  precioTotal?: number;
  /** Compra/Devolución a Proveedor: cuando el producto se compra "por unidad" pero el contenido pesa distinto cada vez (carne, fiambre) — se usa tal cual como cantidad final de stock. */
  pesoReal?: number | null;
  /** Presentación de compra alternativa (Presentacion.unidadCompraId) — si no es una presentación real y activa de este producto, se ignora y sigue con la default. */
  unidadCompraId?: string | null;
  /** Compra/Devolución a Proveedor: cómo llama el proveedor a este producto — se guarda en ProveedorPorProducto, puramente informativo. */
  referenciaProveedor?: string;
}

export interface DatosMovimientoInput {
  proceso: ProcesoGenerico;
  fecha: Date;
  seccionId: string;
  /** Solo Transferencia. */
  seccionDestinoId?: string;
  proveedorId?: string;
  nroFactura?: string;
  /** Solo Merma — id de una fila activa de MotivoMerma (plan "motivos de Consumo/Merma como catálogo administrable", 2026-09-23, P5). */
  motivoId?: string;
  /** Solo Consumo — id de una fila activa de DestinoConsumo. */
  destinoId?: string;
  detalleLibre?: string;
  items: ItemMovimientoInput[];
  /** I3 — UUID generado por el cliente al abrir el formulario, reenviado tal cual en reintentos. Opcional durante el rollout (docs/auditoria-motor2-plan-i3-idempotencia-2026-09-17.md §9.3). */
  claveIdempotencia?: string;
}

export type CodigoRegistrarMovimiento =
  | "CONFLICTO_IDEMPOTENCIA"
  | "SECCION_NO_ENCONTRADA"
  | "SECCION_DESTINO_NO_ENCONTRADA"
  | "MOTIVO_NO_DISPONIBLE"
  | "DESTINO_NO_DISPONIBLE"
  | "FACTURA_INVALIDA"
  | "FACTURA_DUPLICADA"
  | "LINEA_INVALIDA"
  | "SIN_LINEAS_VALIDAS"
  | "STOCK_INSUFICIENTE";

/** `datos` de un `registrarMovimiento` exitoso: `operacionId`/`movimientos` son `null` en el camino de idempotencia "duplicado" (no se volvió a escribir nada). */
export interface DatosRegistrarMovimiento {
  operacionId: string | null;
  movimientos: number | null;
  repetida: boolean;
}

export type ResultadoRegistrarMovimiento = ResultadoCaso<DatosRegistrarMovimiento, CodigoRegistrarMovimiento>;
