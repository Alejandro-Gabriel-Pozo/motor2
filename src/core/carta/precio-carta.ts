import { CLAVES_FIJAS_DEL_SISTEMA } from "./tema";

/**
 * ADR-006 (`docs/adr/ADR-006-carta-como-modulo-interno.md`), Fase 3: formatea un precio de la carta pública con la
 * convención FIJA del sistema (`CLAVES_FIJAS_DEL_SISTEMA` — es-AR, "$", a la izquierda; no configurable, ver `./tema.ts`).
 * Reemplaza `formatPrecio` de `restaurant-menu-design/lib/format-utils.ts`, que recibía la config solo para leer estas
 * mismas 3 claves fijas — acá no hace falta el parámetro, ya son constantes.
 */
export function formatearPrecioCarta(precio: number): string {
  const formateado = precio.toLocaleString(CLAVES_FIJAS_DEL_SISTEMA.precio_locale, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  // precio_posicion es "izquierda" siempre (convención fija, no configurable): el símbolo va adelante, sin condicional.
  return `${CLAVES_FIJAS_DEL_SISTEMA.precio_simbolo}${formateado}`;
}
