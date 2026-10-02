/**
 * Fachada PÚBLICA DE SERVIDOR del dominio `carta` (ADR-006, `docs/adr/ADR-006-carta-como-modulo-interno.md`).
 *
 * Los módulos de `carta` que alcanzan la base (`@/lib/db`) o el runtime de Prisma, directa o transitivamente. Separada de
 * `public.ts` a propósito: esa la importan módulos que terminan en el bundle del cliente, y esta no puede llegar ahí.
 *
 * Sin `import "server-only"`: Vitest, Playwright (specs que importan `core/`) y los scripts standalone (`tsx`) cargan
 * `core/` fuera de la resolución de módulos de Next, donde ese paquete tira al importarse.
 *
 * Solo reexports explícitos (nunca `export *`, nunca lógica), y solo lo que hoy se usa desde afuera del dominio
 * (`core/pos/selector-carta-consulta.ts`).
 */
export { resolverMenuCarta } from "./menu-consulta";
export { descuentosDeProductoEnSucursal } from "./descuento-producto-consulta";
export { ofrecerSincronizarPrecio, resolverGrupoDeProducto } from "./grupo-producto-consulta";
export type { SincronizablePrecioGrupo } from "./grupo-producto-consulta";
export type { EntradaPortalCarta } from "./publica-consulta";
