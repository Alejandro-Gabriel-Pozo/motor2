import type { Proceso } from "@/core/datos/enumerados-del-esquema";

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
