/**
 * Fachada PÚBLICA y PURA del dominio `stock` (Pureza Fase 2, paso 2.1).
 *
 * Fuera de `core/stock/` se importa esta fachada o `public-servidor.ts`, nunca un archivo interno (regla `sin-internals-de-otro-dominio` de
 * `.dependency-cruiser.cjs`). Acá van SOLO los módulos que no alcanzan la base, ni directa ni transitivamente (regla `publico-puro` y
 * `fachadas-publicas-sin-io.test.ts`); lo que sí la toca va en `public-servidor.ts`. Los TIPOS se exportan desde acá aunque su archivo toque la base:
 * se borran al compilar y no arrastran nada al bundle.
 *
 * Solo reexports explícitos (nunca `export *`, nunca lógica), y solo lo que hoy se usa desde afuera del dominio.
 */
export type { EstadoStockConsolidado } from "./consolidado";
export { armarAlertasStock, resumirAlertasStock } from "./alertas";
export type { FilaAlertaStock, ResumenAlertasStock } from "./alertas";
export { armarStockConsolidado, movimientosPorLeer } from "./consolidado";
export type { FilaStockConsolidado, MovimientoPosteriorAlConteo } from "./consolidado";
export { armarStockEnTransito } from "./en-transito";
export type { FilaStockEnTransito } from "./en-transito";
export { seleccionarClaseA } from "./sugerencia-clase-a";
export type { InsumoClaseA } from "./sugerencia-clase-a";
export { decidirCambioDeMinimo, elegirMinimo } from "./stock-minimo";
export { armarStockPorFamilia } from "./por-familia";
export type { FilaStockPorFamilia } from "./por-familia";
export { resolverProximoConteo } from "./frecuencia-conteo";
export { whereSeccionHabitualVigente } from "./seccion-habitual";
export { ESTADO_STOCK_CONSOLIDADO_LABEL } from "./estado-consolidado-ui";
export { ESTADO_STOCK_CONSOLIDADO_COLOR } from "./estado-consolidado-ui";
export {
  CLAVES_DE_PARAMETROS,
  EDITORES_DE_PARAMETROS,
  NAV_STOCK,
  PESTANAS_DE_CONFIGURACION,
  PESTANAS_DE_EXISTENCIAS,
  RUTA_CONFIGURACION,
  RUTAS_DE_LAS_ENTRADAS_DE_STOCK,
  pestanaActualDeStock,
} from "./ui-config";
export type { PantallaDeStock } from "./ui-config";
export { armarParametrosPorInsumo, filaDeMinimoQueRige } from "./parametros-por-insumo";
export type { ParametrosDeUnInsumo } from "./parametros-por-insumo";
