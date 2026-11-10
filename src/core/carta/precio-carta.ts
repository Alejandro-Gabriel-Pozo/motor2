import { formatearMonto } from "@/core/formato-de-numero";

/**
 * ADR-006 (`docs/adr/ADR-006-carta-como-modulo-interno.md`), Fase 3: formatea un precio de la carta pública con la
 * convención FIJA del sistema (`CLAVES_FIJAS_DEL_SISTEMA` — es-AR, "$", a la izquierda; no configurable, ver `./tema.ts`).
 * Reemplaza `formatPrecio` de `restaurant-menu-design/lib/format-utils.ts`, que recibía la config solo para leer estas
 * mismas 3 claves fijas — acá no hace falta el parámetro, ya son constantes.
 */
export function formatearPrecioCarta(precio: number): string {
  // Regla del dueño 2026-11-10: el dinero siempre sale por `formatearMonto` («$ 3.500,00»), también en la carta pública (cambio visible para el cliente final).
  return formatearMonto(precio);
}
