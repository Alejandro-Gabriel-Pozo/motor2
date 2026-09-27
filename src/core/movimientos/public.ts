/**
 * Fachada PÚBLICA y PURA del dominio `movimientos` (Task #41, Fase C2 — mismo patrón que el piloto C1 de `core/catalogo/`).
 *
 * Fuera de `core/movimientos/` se importa esta fachada o `public-servidor.ts`, nunca un archivo interno (regla
 * `sin-internals-de-otro-dominio` de `.dependency-cruiser.cjs`). Acá van SOLO los módulos que no alcanzan `@/lib/db` ni el
 * runtime de Prisma, ni directa ni transitivamente (regla `publico-puro`): la importan módulos que terminan en el bundle
 * del cliente (`core/navegacion/estructura.ts`, `core/pos/cantidad-pedido.ts`), así que meter acá algo que toque la base la
 * arrastraría al navegador. Lo que sí toca la base va en `public-servidor.ts`.
 *
 * Contrato explícito con `stock` (legítimo): `core/stock/consolidado.ts` usa `tieneStockReal` — la misma regla de qué productos
 * llevan stock real que aplica el motor de movimientos.
 *
 * `redondearMoneda` NO se expone acá: es de `@/core/moneda` y se importa de ahí (C2, paso 1).
 *
 * Solo reexports explícitos (nunca `export *`, nunca lógica), y solo lo que hoy se usa desde afuera del dominio.
 */
export {
  ACCION_POR_PROCESO,
  TRANSICIONES,
  esSignoFijo,
  productoValidoParaProceso,
  redondearACantidadDeUnidad,
  tieneStockReal,
} from "./transiciones";
export { NAV_MOVIMIENTOS, obtenerConfigProceso } from "./ui-config";
export type { ProcesoUiConfig } from "./ui-config";
export { OPERACION_QUE_NO_ES_REVERSION_POR_ANULACION, detalleReversionDeCompra, detalleReversionDeVenta } from "./anulaciones";
export type { ResultadoAnulacionDeVenta, LineaVendida, LineaDeReversionDeVenta } from "./anulaciones";
export type { AccionConteo } from "@prisma/client";
