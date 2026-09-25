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
