/**
 * Fachada PÚBLICA DE SERVIDOR del dominio `fiscal` (Pureza 0.5).
 *
 * Lo que recibe un cliente de base (`Db`): la pregunta «¿la empresa ya tiene una factura autorizada por ARCA en producción?», de la que depende que el CUIT sea
 * inmutable (ADR-021). Separada de `public.ts` a propósito: esa la importan módulos que terminan en el bundle del cliente, y esta no puede llegar ahí.
 *
 * Sin `import "server-only"`: Vitest, Playwright y los scripts standalone (`tsx`) cargan `core/` fuera de la resolución de módulos de Next.
 *
 * Solo reexports explícitos (nunca `export *`, nunca lógica), y solo lo que hoy se usa desde afuera del dominio.
 */
export { MENSAJE_CUIT_INMUTABLE, empresaTieneFacturaAutorizada } from "./factura-autorizada";
