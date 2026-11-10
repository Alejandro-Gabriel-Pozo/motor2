/**
 * Formatos de la pantalla de la mesa. Desde 2026-11-09 el formateo de salida de números es UNO solo y vive en `core/formato-de-numero.ts` (regla del
 * dueño «1.000,00»); estas dos funciones se reexportan acá porque el POS y los reportes las importan de `@/core/pos/public`. Las horas (con la zona de la
 * empresa) viven en `core/tiempo`.
 */
export { formatearMonto, formatearCantidad } from "@/core/formato-de-numero";
