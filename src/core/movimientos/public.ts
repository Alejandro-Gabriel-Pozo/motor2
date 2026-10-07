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
export { DESTINOS_CONSUMO_SEMILLA, MOTIVOS_MERMA_SEMILLA } from "./motivos-semilla";
export { NAV_MOVIMIENTOS, obtenerConfigProceso } from "./ui-config";
export type { ProcesoUiConfig } from "./ui-config";
export {
  OPERACION_QUE_NO_ES_REVERSION_POR_ANULACION,
  detalleReversionDeCompra,
  detalleReversionDeVenta,
  evaluarAnulacionDeVenta,
  construirReversionDeVenta,
  mensajeVentaAnulada,
  descripcionAuditoriaAnulacionDeVenta,
} from "./anulaciones";
export type { ResultadoAnulacionDeVenta, LineaVendida, LineaDeReversionDeVenta } from "./anulaciones";
export { armarFilasDeMovimiento } from "./armar-filas-de-movimiento";
export type { ConsumoParaFilas } from "./armar-filas-de-movimiento";
export type { AccionConteo } from "@prisma/client";
export { crearLibroDeStock } from "./origen-venta";
export type { SeccionCandidata } from "./origen-venta";
export type { DatosDeOrigen, OrigenPreparado, OrigenVenta } from "./origen-venta-datos";
export { armarFilasStockParaConteo, elegirLoteMasProximoAVencer, repartirConsumoPorFamilia } from "./reparto-de-stock";
export type { FilaStockParaConteo, ParteDeReparto } from "./reparto-de-stock";
