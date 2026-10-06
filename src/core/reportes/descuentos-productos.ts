/**
 * Reporte de descuentos de productos (Fase 2 de promociones, ver docs/plan-promociones-un-solo-concepto-2026-10-01.md): cuánto se ahorraron los
 * clientes en el rango por el descuento porcentual que la carta le pone a un producto (`DescuentoProductoSucursal`), por producto.
 *
 * Fuente: los `CuentaItem` SUELTOS (sin promo) que ya salieron en una venta (`operacionId` no nulo, operación no anulada) y que congelaron el precio
 * de lista en `precioCartaUnitario` (solo lo escribe el descuento de producto en un suelto). El ahorro es Σ cantidad × (lista − cobrado) sobre las
 * filas NETAS: una anulación es una fila espejo con cantidad negativa en la MISMA operación, así que se resta sola.
 *
 * Con un cliente con descuento rige SOLO EL MAYOR (`precioCobradoConDescuentos`): si ganó el del cliente, esa venta es de «Descuentos por cliente» y no
 * se cuenta acá — se reconoce porque su `MovimientoStock` VENTA lleva `precioListaUnitario` (que solo se escribe cuando gana el del cliente).
 */

export interface FilaDescuentoProducto {
  productoId: string;
  codigo: string;
  producto: string;
  unidades: number;
  /** Lo que se hubiera cobrado a precio de lista. */
  importeALista: number;
  /** Lo que se cobró de verdad (con el descuento del producto). */
  importeCobrado: number;
  /** `importeALista - importeCobrado`. */
  ahorro: number;
  /** `ahorro / importeALista`, en % con un decimal. */
  descuentoEfectivoPct: number | null;
}

export interface ReporteDescuentosProductos {
  desde: Date;
  hasta: Date;
  importeALista: number;
  importeCobrado: number;
  ahorro: number;
  descuentoEfectivoPct: number | null;
  productos: FilaDescuentoProducto[];
}