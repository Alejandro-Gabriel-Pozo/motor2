import { SIN_PROVEEDOR } from "./compras-filtros";

/**
 * Listado de compras registradas, una fila por FACTURA (una `Operacion` de proceso COMPRA), con sus líneas. Hasta ahora una compra solo se
 * veía por el historial de un producto o por su ID de operación: no había forma de ver «qué se le compró a este proveedor, con qué factura,
 * cuándo y por cuánto». Es de solo lectura (no edita ni anula nada; eso es otra fase, ver
 * docs/grounding-compras-correccion-y-notas-de-credito-2026-09-19.md, K1b a K1d).
 *
 * `proveedorId === SIN_PROVEEDOR` filtra las compras cargadas sin proveedor. Paginado por cursor (más recientes primero).
 */
export { SIN_PROVEEDOR };
export const TAMANO_PAGINA_COMPRAS = 30;

export interface FiltroCompras {
  desde?: Date;
  hasta?: Date;
  /** Id de un proveedor, o `SIN_PROVEEDOR` para las compras sin proveedor. */
  proveedorId?: string;
  /** Texto contenido en el N.º de factura (sin distinguir mayúsculas). */
  factura?: string;
  cursor?: string;
}

export interface RenglonCompra {
  idMovimiento: string;
  productoCodigo: string;
  productoNombre: string;
  cantidad: number;
  unidad: string;
  loteVencimiento: Date | null;
  precioTotal: number;
  precioPorUnidadStock: number;
  seccionNombre: string;
}

export interface CompraRegistrada {
  idOperacion: string;
  fecha: Date;
  proveedorId: string | null;
  proveedorNombre: string | null;
  nroFactura: string | null;
  cargadaPor: string;
  detalle: string | null;
  total: number;
  /** Alguna línea se cargó sin precio: el total no es el de la factura. */
  haySinPrecio: boolean;
  /** La compra está anulada (null = vigente): se muestra marcada y NO suma al gasto. Hoy ninguna compra se puede anular; queda listo para K1c. */
  anuladaEn: Date | null;
  anuladaPorEmail: string | null;
  /** Productos DISTINTOS de esta factura — dos renglones del mismo producto cuentan una sola vez (antes "líneas", un conteo de renglones que los confundía; §4, docs/planes-demo-y-claridad-reportes-2026-09-21.md, coordinado con el mismo vocabulario de §2 en /reportes/periodo). */
  cantidadProductos: number;
  renglones: RenglonCompra[];
}

export interface PaginaCompras {
  items: CompraRegistrada[];
  nextCursor: string | null;
}