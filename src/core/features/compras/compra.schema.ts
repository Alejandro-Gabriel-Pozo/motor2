/**
 * Tipos de la línea de una Compra o Devolución a proveedor, para `compra.guard.ts` (convención "guard por feature", 2026-09-25: cada
 * feature que recibe o modifica datos tiene su propio guard, que usa las funciones comunes de `src/core/datos/` en vez de
 * reemplazarlas).
 */

/** Lo que se teclea, tal cual llega — todavía sin validar. */
export interface DatosLineaCompra {
  cantidad: number | null | undefined;
  precioTotal: number | null | undefined;
  pesoReal: number | null | undefined;
}

/** Lo mismo, ya validado y listo para calcular: cantidad obligatoria (nunca `null`), precioTotal (compra sin precio → 0, sigue
 *  permitida) y pesoReal (`null` si no se cargó). */
export interface LineaCompraValidada {
  cantidad: number;
  precioTotal: number;
  pesoReal: number | null;
}

/** Por qué `evaluarAnulacion` (src/core/compras/anulacion.ts) rechaza una anulación. Se declara ACÁ y `ResultadoAnulacion` la usa: así `core/compras` depende de su contrato (`features/compras`) y no al revés, sin ciclo. */
export type MotivoAnulacionRechazada = "NO_ES_COMPRA" | "YA_ANULADA" | "SIN_LINEAS" | "STOCK_CONSUMIDO" | "CONTEO_POSTERIOR";

/** Lo que se puede corregir de una factura ya cargada: solo la cabecera (ver `src/core/compras/correccion.ts`). */
export interface CorreccionCompraInput {
  /** Vacío o null = sin proveedor. */
  proveedorId: string | null;
  nroFactura: string;
  detalleLibre: string;
}

/** Lo que la persona vio al abrir el formulario: es la guarda optimista contra pisar una corrección hecha por otra persona. */
export interface CabeceraVista {
  proveedorId: string | null;
  nroFactura: string | null;
  detalleLibre: string | null;
}
