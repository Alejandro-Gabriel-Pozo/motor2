/**
 * Fachada del dominio «caja» (etapas C1 y C3, docs/diseno-caja-y-cobro-paridad-pedernal-2026-11-16.md y docs/diseno-caja-c3-cuenta-de-cobro-y-marcas-2026-11-16.md): lo único que el resto del código importa de `src/core/caja/`. Puro: sin reloj, sin azar, sin I/O.
 */
export { DENOMINACIONES_DE_BILLETE, diferenciaDeArqueo, totalContadoEnCentavos } from "./arqueo";
export type { ConteoDeBilletes } from "./arqueo";
export {
  decidirAltaDeCuenta,
  decidirAltaDeMedio,
  decidirCambioDeEstado,
  decidirConVersion,
  identificadorExternoValido,
  nombreDeConfiguracionValido,
  sucursalEnAlcanceDeEscritura,
  tipoDeCuentaValido,
  tipoDeMedioValido,
} from "./configuracion";
export type { CuentaGuardada, MedioGuardado } from "./configuracion";
export { datosCompletados, datosEnFormaCompleta, sinDatos, validarDatosDelCobro } from "./datos-del-cobro";
export type { DatosDelCobro, DatosDelCobroCompletos, MotivoDeDatoInvalido } from "./datos-del-cobro";
export { CUENTAS_ADMITIDAS, DATOS_ADMITIDOS_POR_MEDIO, DATOS_DEL_COBRO, TIPOS_DE_CUENTA, TIPOS_DE_MEDIO, validarDatosQuePide, validarParDeCobro } from "./medios";
export type { DatoDelCobro, DatosQuePideElMedio, TipoDeCuenta, TipoDeMedio } from "./medios";
export { MAXIMO_DE_RENGLONES_DE_COBRO, repartirCobro } from "./cobro";
export type { RenglonDeCobro } from "./cobro";
export { TOPE_EN_CENTAVOS, centavosDeImporte, importeDeCentavos, textoDeCentavos } from "./dinero-de-caja";
export { CLASES_DE_MOVIMIENTO, importeValidoParaClase, signoDeClase } from "./sesion";
export type { ClaseDeMovimiento } from "./sesion";
