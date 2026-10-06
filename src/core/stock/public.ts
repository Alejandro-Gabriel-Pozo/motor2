/**
 * Fachada PÚBLICA y PURA del dominio `stock` (Pureza Fase 2, paso 2.1).
 *
 * Fuera de `core/stock/` se importa esta fachada, nunca un archivo interno (regla `sin-internals-de-otro-dominio` de
 * `.dependency-cruiser.cjs`). Acá van SOLO los módulos que no alcanzan `@/lib/db` ni el runtime de Prisma (regla `publico-puro`).
 *
 * Solo reexports explícitos (nunca `export *`, nunca lógica), y solo lo que hoy se usa desde afuera del dominio.
 */
export { calcularAlertasStock, obtenerResumenAlertasStock } from "./alertas";
export { calcularStockConsolidado } from "./consolidado";
export type { EstadoStockConsolidado } from "./consolidado";
export { resolverProximoConteo } from "./frecuencia-conteo";
export { whereSeccionHabitualVigente } from "./seccion-habitual";
