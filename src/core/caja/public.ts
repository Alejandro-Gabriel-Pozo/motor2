/**
 * Fachada del dominio «caja» (etapa C1, docs/diseno-caja-y-cobro-paridad-pedernal-2026-11-16.md): lo único que el resto del código importa de `src/core/caja/`. Puro: sin reloj, sin azar, sin I/O.
 */
export { DENOMINACIONES_DE_BILLETE, diferenciaDeArqueo, totalContadoEnCentavos } from "./arqueo";
export type { ConteoDeBilletes } from "./arqueo";
export { MAXIMO_DE_RENGLONES_DE_COBRO, repartirCobro } from "./cobro";
export type { RenglonDeCobro } from "./cobro";
export { TOPE_EN_CENTAVOS, centavosDeImporte, centavosDeTexto, importeDeCentavos, textoDeCentavos } from "./dinero-de-caja";
export { CLASES_DE_MOVIMIENTO, importeValidoParaClase, signoDeClase } from "./sesion";
export type { ClaseDeMovimiento } from "./sesion";
