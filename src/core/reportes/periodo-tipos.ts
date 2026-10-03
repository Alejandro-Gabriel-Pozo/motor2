import type { Proceso } from "@prisma/client";
import { ZONA_UTC, rangoDeDias } from "@/core/tiempo/zona-horaria";

export interface FiltrosPeriodo {
  proceso?: Proceso;
  seccionId?: string;
  productoId?: string;
}

export interface ItemPeriodo {
  fecha: Date;
  productoId: string;
  productoNombre: string;
  productoCodigo: string;
  detalle: string;
  cantidad: number;
  loteVencimiento: Date | null;
  proveedorNombre: string | null;
  /** Id del proveedor de la operación (null = sin proveedor): para enlazar al listado de compras. */
  proveedorId: string | null;
  nroFactura: string | null;
  proceso: Proceso;
  seccionId: string;
  seccionNombre: string;
  idMovimiento: string;
  idOperacion: string;
  precioTotal: number;
  precioPorUnidadStock: number;
  /** Solo proceso VENTA, desde 2026-09-17 — ver docstring en schema.prisma (MovimientoStock.costoUnitarioVenta). */
  costoUnitarioVenta: number | null;
  /**
   * La operación de esta línea está anulada (una venta o una compra). Todo cálculo de dinero la saltea: una venta o una compra anulada es algo que no
   * ocurrió, y su efecto en el stock ya lo deshizo el contra-asiento. La línea sigue en `items` (para trazabilidad); lo que no debe hacer es sumar.
   */
  anulada: boolean;
}

/**
 * Rango inclusivo [desde 00:00, hasta 23:59:59.999] — en UTC, no en la hora
 * local del proceso Node. `desde`/`hasta` llegan como Date "de solo día"
 * (`new Date('yyyy-MM-dd')` del lado del cliente, mismo patrón que ya usa
 * el resto del proyecto — ver venta-form.tsx/reclasificar-form.tsx): ese
 * constructor SIEMPRE interpreta el string como medianoche UTC, sin
 * importar la zona horaria del navegador. El bug que Apps Script arrastraba
 * (Reportes.js:41-48, parsearFechaLocal_) salía de comparar esa medianoche
 * UTC contra un `setHours(0,0,0,0)` que corre en la zona LOCAL del
 * script — acá se evita de raíz usando `setUTCHours` en vez de `setHours`,
 * así el límite del rango se calcula con el mismo criterio (UTC) que ya se
 * usó para construir el valor, sin depender de en qué TZ corra el server.
 */
export function rangoUtc(desde: Date, hasta: Date): { desde: Date; hasta: Date } {
  return rangoDeDias(desde, hasta, ZONA_UTC);
}
