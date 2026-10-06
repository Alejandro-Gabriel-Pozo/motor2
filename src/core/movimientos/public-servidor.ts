/**
 * Fachada PÚBLICA DE SERVIDOR del dominio `movimientos` (Task #41, Fase C2 — mismo patrón que el piloto C1 de `core/catalogo/`).
 *
 * Los módulos de `movimientos` que alcanzan la base (`@/lib/db`) o el runtime de Prisma, directa o transitivamente — o que
 * trabajan sobre una transacción de Prisma que les pasan (`idempotencia`, `producto-cache`). Separada de `public.ts` a
 * propósito: esa la importan módulos que terminan en el bundle del cliente, y esta no puede llegar ahí. `reintentar` es
 * código puro, pero es el ciclo de reintento de `conTransaccionSerializable` (orquestación de escrituras del servidor): va acá
 * y no en `public.ts` para que la regla `accion-migrada-sin-orquestacion` no se pueda esquivar por la fachada pura.
 *
 * `registrar-venta` importa `calcularCostosYMargenes` de `core/reportes/costos.ts` (congela el costo al vender, en la misma
 * transacción): es el ÚNICO ciclo entre dominios de `core/` (movimientos ↔ reportes), legítimo y documentado en
 * `.dependency-cruiser-excepciones.cjs`; se resuelve en C3.
 *
 * Sin `import "server-only"`: Vitest, Playwright (specs que importan `core/`) y los scripts standalone (`tsx`) cargan
 * `core/` fuera de la resolución de módulos de Next, donde ese paquete tira al importarse.
 *
 * Solo reexports explícitos (nunca `export *`, nunca lógica), y solo lo que hoy se usa desde afuera del dominio.
 */
export { conTransaccionSerializable, esChoqueDeIndiceUnico, esConflictoDeEscritura } from "./con-reintento";
export { conReintento } from "./reintentar";
export { MENSAJE_CONFLICTO_IDEMPOTENCIA, calcularPayloadHash, decidirIdempotencia } from "./idempotencia";
export type { ResultadoChequeoIdempotencia } from "./idempotencia";
export { MENSAJE_FACTURA_DUPLICADA, esChoqueDeFacturaUnica } from "./factura-unica";
export {
  calcularSaldoPorLote,
  calcularSaldoTotal,
  listarStockParaConteo,
  obtenerLoteMasProximoAVencer,
  obtenerSeccionPropia,
  resolverConsumoPorFamilia,
  seccionesConStock,
  validarStockSuficiente,
} from "./stock";
export { crearCacheProducto } from "./producto-cache";
export type { AvisoStockNegativo } from "./registrar-venta";
export { resolverPrecioVenta } from "./precio-venta";
