/**
 * Fachada de SERVIDOR del dominio `pos`: lo que usa Node (`node:crypto`, por la huella de la línea configurada) y que por eso NO va en `public.ts` (lo importan componentes de cliente: si
 * esto entrara al bundle del navegador, rompería la CSP: `test/arquitectura/fachadas-publicas-sin-io.test.ts`). Solo reexports explícitos, y solo lo que
 * hoy se usa desde afuera del dominio. Sin `import "server-only"` (Vitest y los scripts cargan `core/` fuera de Next).
 */
// GO-3b (ADR-032): la administración de los combos valida la configuración fija de una entrada con lo mismo que la venta (`armarLineaConfigurada`).
export { armarLineaConfigurada } from "./linea-configurada";
// Promo «a elegir» (ADR-032 D-6 enmendada, 2026-11-05): armar lo que el mozo eligió dentro de una entrada «a elegir», contra lo permitido (usa `armarLineaConfigurada`, por eso va acá y no en `public.ts`).
export { armarConfiguracionDeEntradaAElegir } from "./configuracion-de-entrada-a-elegir";
export type { EntradaAElegirLeida } from "./configuracion-de-entrada-a-elegir";
