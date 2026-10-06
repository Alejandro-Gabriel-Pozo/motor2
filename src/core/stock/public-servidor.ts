/**
 * Fachada PÚBLICA DE SERVIDOR del dominio `stock` (Pureza Fase 2, paso 2.2).
 *
 * Los módulos de `stock` que alcanzan la base, directa o transitivamente: funciones de cálculo que viven en el mismo archivo que una consulta
 * (reciben el cliente de base por parámetro). Separada de `public.ts` a propósito: esa la importan módulos que terminan en el bundle del cliente.
 * Cuando la Fase 3 separe cada cálculo de su consulta, el cálculo pasa a `public.ts` y acá queda solo la consulta.
 *
 * Sin `import "server-only"`: Vitest, Playwright y los scripts `tsx` cargan `core/` fuera de la resolución de módulos de Next.
 *
 * Solo reexports explícitos (nunca `export *`, nunca lógica), y solo lo que hoy se usa desde afuera del dominio.
 */
export { calcularAlertasStock, obtenerResumenAlertasStock } from "./alertas";
export { calcularStockConsolidado } from "./consolidado";
export { calcularStockEnTransito } from "./en-transito";
export { sugerirInsumosClaseA } from "./sugerencia-clase-a";
export { calcularStockPorFamilia } from "./por-familia";
