/**
 * Fachada PÚBLICA DE SERVIDOR del dominio `reportes` (Task #41, Fase C3).
 *
 * Los módulos de `reportes` que alcanzan la base (`@/lib/db`) o el runtime de Prisma, directa o transitivamente. Separada de
 * `public.ts` a propósito: esa la importan módulos que terminan en el bundle del cliente, y esta no puede llegar ahí.
 *
 * Sin `import "server-only"`: Vitest, Playwright (specs que importan `core/`) y los scripts standalone (`tsx`) cargan
 * `core/` fuera de la resolución de módulos de Next, donde ese paquete tira al importarse.
 *
 * Solo reexports explícitos (nunca `export *`, nunca lógica), y solo lo que hoy se usa desde afuera del dominio:
 * `core/carta/reporte-secciones.ts` (comun + periodo) y `core/movimientos/registrar-venta.ts` (costos — el único ciclo
 * real entre dominios de `core`, ya exceptuado en `dependencias.test.ts`).
 */
export { redondearCantidad } from "./comun";
export type { Db } from "./comun";
export {
  agruparVentasPorCategoria,
  obtenerReportePorPeriodoConCatalogo,
  pvSinCategoriaDe,
  generarReporteVentasPorCategoria,
} from "./periodo";
export type { FilaCategoriaVenta } from "./periodo";
export { calcularCostosYMargenes } from "./costos";
export { compararRendimientosPorSucursal } from "./rendimiento-por-sucursal";
