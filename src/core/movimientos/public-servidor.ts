/**
 * Fachada PÚBLICA DE SERVIDOR del dominio `movimientos` (Task #41, Fase C2 — mismo patrón que el piloto C1 de `core/catalogo/`).
 *
 * Reexporta, y solo eso, lo que de verdad queda en `core/movimientos/` para el servidor tras las piezas 5.1 a 5.3 del Hito 5 (rama `pureza-integracion`):
 *  - los clasificadores de errores de la transacción serializable (`con-reintento.ts`: `esConflictoDeEscritura`, `esChoqueDeIndiceUnico`), puros;
 *  - el ciclo de reintento (`reintentar.ts`: `conReintento` y el tipo `OpcionesEspera`), puro y sin dependencias;
 *  - la idempotencia I3 (`idempotencia.ts`: el hash del payload con `node:crypto` y la decisión sobre un resultado previo), que opera sobre datos que le pasa quien lee la clave;
 *  - el clasificador del choque de factura única (`factura-unica.ts`) y el tipo `AvisoStockNegativo` (`registrar-venta.ts`).
 * Ya no hay nada que alcance la base (`@/lib/db`) ni el runtime de Prisma: lo impuro que vivía acá salió de `core` — `resolverPrecioVenta` a `server/lecturas/movimientos/precio-venta.ts` (5.2) y
 * `conTransaccionSerializable`, que abre la transacción y escribe en la consola, a `src/lib/transaccion-serializable.ts` (5.3) —, y el ciclo con `core/reportes` que esta cabecera describía
 * (`registrar-venta` ↔ `calcularCostosYMargenes`) ya no existe: `registrar-venta.ts` solo trae un tipo de `origen-venta-datos`.
 *
 * Sigue separada de `public.ts` a propósito: esa la importan módulos que terminan en el bundle del cliente, y esta no puede llegar ahí (`idempotencia` usa `node:crypto`). Y sigue siendo el
 * único camino por el que una Server Action ya migrada podría esquivar a su caso de uso (reintento e idempotencia son orquestación de escrituras): por eso la protege la regla
 * `accion-migrada-sin-orquestacion` (`.dependency-cruiser.cjs`), que le prohíbe importar esta fachada, `lib/transaccion-serializable.ts`, `con-reintento`, `reintentar` e `idempotencia`.
 *
 * Sin `import "server-only"`: Vitest, Playwright (specs que importan `core/`), los scripts standalone (`tsx`) y la consola de plataforma (que importa `esChoqueDeIndiceUnico` por acá)
 * cargan `core/` fuera de la resolución de módulos de Next, donde ese paquete tira al importarse.
 *
 * Solo reexports explícitos (nunca `export *`, nunca lógica), y solo lo que hoy se usa desde afuera del dominio.
 */
export { esChoqueDeIndiceUnico, esConflictoDeEscritura } from "./con-reintento";
export { conReintento } from "./reintentar";
export type { OpcionesEspera } from "./reintentar";
export { MENSAJE_CONFLICTO_IDEMPOTENCIA, calcularPayloadHash, decidirIdempotencia } from "./idempotencia";
export type { ResultadoChequeoIdempotencia } from "./idempotencia";
export { MENSAJE_FACTURA_DUPLICADA, esChoqueDeFacturaUnica } from "./factura-unica";
export type { AvisoStockNegativo } from "./registrar-venta";
