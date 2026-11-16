/**
 * Fachada PÚBLICA y PURA del dominio `compras` (Pureza Fase 2, paso 2.1).
 *
 * Fuera de `core/compras/` se importa esta fachada, nunca un archivo interno (regla `sin-internals-de-otro-dominio` de
 * `.dependency-cruiser.cjs`). Acá van SOLO los módulos que no alcanzan `@/lib/db` ni el runtime de Prisma (regla `publico-puro`).
 *
 * Solo reexports explícitos (nunca `export *`, nunca lógica), y solo lo que hoy se usa desde afuera del dominio: la anulación y la corrección de una
 * compra, que consumen sus casos de uso (`server/actions/movimientos/casos-de-uso/`) y su persistencia (`server/persistencia/compras/`).
 */
export { claveDeLote, evaluarAnulacion, evaluarPosterioresAAnularCompra } from "./anulacion";
export type { LineaComprada, LineaDeReversion, SaldosPorLote } from "./anulacion";
export {
  cabeceraCoincide,
  descripcionAuditoriaCorreccion,
  diferenciasDeCabecera,
  mensajeCompraCorregida,
  normalizarCorreccion,
  validarCorreccion,
} from "./correccion";
export { decidirAnulacionDeFactura, decidirCorreccionDeDatos } from "./reglas-de-la-factura";
export {
  CONDICIONES_DE_CONTROL,
  ESTADOS_DE_RECEPCION,
  ETIQUETA_DE_CONDICION_DE_CONTROL,
  LARGO_MAXIMO_DE_LA_OBSERVACION,
  MENSAJE_RECEPCION_NO_ENCONTRADA,
  MENSAJE_RECEPCION_YA_RECIBIDA,
  decidirConfirmacionDeRecepcion,
  decidirRegistroDeControl,
  estadoInicialDeLaParte,
  mensajeFechaDeStockFueraDeRango,
  prorratearPrecioDeRenglon,
  validarControlDeLinea,
  validarEntradasDeRecepcion,
} from "./recepcion";
export type {
  CodigoDeRechazoDeControl,
  CodigoDeRechazoDeEntradas,
  CodigoDeRechazoDeRecepcion,
  CodigoDeRechazoDeRegistroDeControl,
  CondicionDeControl,
  EntradaDeConfirmacionDeRecepcion,
  EntradaDeRecepcion,
  EntradaDeRegistroDeControl,
  SeccionParaRecibir,
} from "./recepcion";
export {
  ETIQUETA_DE_MEDIO_DE_PAGO,
  MEDIOS_DE_PAGO,
  decidirDeclaracionDePago,
  esCondicionDePago,
  esMedioDePago,
  estadoDePago,
  etiquetaDeEstadoDePago,
} from "./pago-de-factura";
export type { CondicionDePago, EstadoDePago, MedioDePago } from "./pago-de-factura";
export { faltaRepartir, repartirFactura } from "./reparto-de-factura";
export type { RepartoDeFactura } from "./reparto-de-factura";
export { normalizarNumeroDeComprobante } from "./numero-de-comprobante";
export { DIAS_DE_VENTANA_DE_DUPLICADO, avisoDePosibleDuplicado, posiblesDuplicados } from "./posible-duplicado";
export type { CompraCandidata, CompraNueva } from "./posible-duplicado";
export {
  PASOS_DE_COMPRA,
  avisoDeImporteCero,
  avisoDeUnidadNoVigente,
  avisosDeImporteCero,
  cantidadEnStock,
  decidirUnidadDePrecarga,
  etiquetaDeUnidad,
  fusionarFilasConPrecarga,
  mensajeFinalDeCompra,
  pasoAnterior,
  pasoSiguiente,
  precioPorUnidad,
  seMuestraElPesoReal,
  unidadEfectiva,
  validarPasoDonde,
  validarPasoFactura,
  validarPasoLineas,
} from "./carga-por-pasos";
export type { ErrorDePaso, LineaParaValidar, PasoDeCompra, UnidadDeCompra, UnidadesDeCompraDelProducto } from "./carga-por-pasos";
export {
  CONTROL_RECEPCION_EXCEDE_LA_ORDEN,
  ESTADOS_DE_ORDEN,
  ETIQUETA_DE_AVANCE_DE_RECEPCION,
  ETIQUETA_DE_ESTADO_DE_ORDEN,
  ETIQUETA_DE_MOTIVO_DE_CIERRE,
  ETIQUETA_DE_NIVEL_DE_CONTROL,
  MENSAJE_EXCEDE_LA_ORDEN_BLOQUEADA,
  MENSAJE_EXCEDE_LA_ORDEN_SIN_CONFIRMAR,
  MENSAJE_ORDEN_NO_ENCONTRADA,
  MENSAJE_VINCULO_ORDEN_NO_PEDIDA,
  MOTIVOS_DE_CIERRE,
  NIVELES_DE_CONTROL,
  NIVEL_POR_DEFECTO_DEL_CONTROL,
  avanceDeRecepcionDeOrden,
  decidirAnularOrden,
  decidirCerrarOrden,
  decidirExcesoContraLaOrden,
  decidirPedirOrden,
  decidirVinculoConOrden,
  esNivelDeControl,
  validarDatosDeOrden,
  validarMotivoDeAnulacionDeOrden,
} from "./orden-de-compra";
export type {
  AvanceDeRecepcionDeOrden,
  CodigoDeRechazoDeDatosDeOrden,
  CodigoDeRechazoDeOrden,
  CodigoDeRechazoDeVinculo,
  EstadoDeOrden,
  MotivoDeCierre,
  NivelDeControl,
} from "./orden-de-compra";
