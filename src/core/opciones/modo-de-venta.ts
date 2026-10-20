import type { ModoDeVenta } from "./tipos";

/**
 * El MODO DE VENTA de un producto (Fase 4 de la ola «precio y carta», ADR-035; `Producto.modoDeVenta`). Puro: sin Prisma.
 *
 * Un producto DIRECTO tiene su precio (`precioVenta`). Uno BASE_CONFIGURABLE («se vende por opción») tiene el precio final de cada configuración en su grupo de medida en ABSOLUTO: el precio guardado
 * se conserva pero no se cobra ni se edita.
 */

/** Si el modo guardado (TEXT de lista cerrada en la base) es «se vende por opción». Cualquier otro valor es DIRECTO: el CHECK de la base no deja guardar otro. */
export function esBaseConfigurable(modo: ModoDeVenta | string): boolean {
  return modo === "BASE_CONFIGURABLE";
}
