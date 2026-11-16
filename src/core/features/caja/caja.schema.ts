import type { ConteoDeBilletes, DatoDelCobro, DatosQuePideElMedio, MotivoDeDatoInvalido, RenglonDeCobro } from "@/core/caja/public";
import type { Exito, Fracaso } from "@/core/resultado-caso";

/**
 * Tipos de la feature «caja» (etapa C1, docs/diseno-caja-y-cobro-paridad-pedernal-2026-11-16.md): los comandos ya validados y los resultados de los casos de uso de `src/server/actions/caja/`. Todo error es un CÓDIGO estable
 * (la pantalla lo traduce a texto). El dinero viaja en CENTAVOS enteros (`bigint`), nunca como `number` decimal.
 */

export interface ComandoAbrirSesion {
  /** UUID que la pantalla genera al abrir el formulario y repite en cada reintento. */
  claveIdempotencia: string;
  /** El fondo inicial en centavos (cero o más; puede ser $0). */
  fondoEnCentavos: bigint;
}

export interface ComandoMovimientoManual {
  claveIdempotencia: string;
  sesionId: string;
  sentido: "INGRESO" | "EGRESO";
  /** Siempre positivo; el signo lo pone el sentido. */
  importeEnCentavos: bigint;
  motivo: string;
}

export interface ComandoAnularMovimiento {
  claveIdempotencia: string;
  movimientoId: string;
  motivo: string;
}

export interface ComandoCobrarCuenta {
  claveIdempotencia: string;
  cuentaId: string;
  /** El total que vio quien cobra: si el de la cuenta cambió, no se cobra un número viejo (`TOTAL_CAMBIO`). */
  totalVistoEnCentavos: bigint;
  renglones: readonly RenglonDeCobro[];
}

export interface ComandoCerrarSesion {
  sesionId: string;
  conteo: ConteoDeBilletes;
  /** Da por buenos («conforme») los medios que no son efectivo; obligatorio si hubo movimientos en alguno. */
  conformeDeLosDemasMedios: boolean;
  observacion: string | null;
}

export type CodigoDeFalloDeAbrirSesion = "CLAVE_REUTILIZADA" | "SUCURSAL_INACTIVA" | "CAJA_YA_ABIERTA" | "SUCURSAL_NO_ENCONTRADA";
export type ResultadoAbrirSesion = Exito<{ sesionId: string; yaExistia: boolean }> | (Fracaso<CodigoDeFalloDeAbrirSesion> & { sesionId?: string });

export type CodigoDeFalloDeMovimiento = "CLAVE_REUTILIZADA" | "SESION_NO_ENCONTRADA" | "SESION_CERRADA";
export type ResultadoMovimientoManual = Exito<{ movimientoId: string; yaExistia: boolean; superaElEfectivo: boolean }> | Fracaso<CodigoDeFalloDeMovimiento>;

export type CodigoDeFalloDeAnulacion = CodigoDeFalloDeMovimiento | "MOVIMIENTO_NO_ENCONTRADO" | "MOVIMIENTO_NO_ANULABLE" | "MOVIMIENTO_YA_ANULADO" | "SIN_PERMISO_SOBRE_MOVIMIENTO_AJENO";
export type ResultadoAnularMovimiento = Exito<{ movimientoId: string; yaExistia: boolean }> | Fracaso<CodigoDeFalloDeAnulacion>;

export type CodigoDeFalloDeCobro =
  | "CLAVE_REUTILIZADA"
  | "CUENTA_NO_ENCONTRADA"
  | "CUENTA_ABIERTA"
  | "CUENTA_SIN_VENTA"
  | "CUENTA_YA_COBRADA"
  | "NADA_PARA_COBRAR"
  | "TOTAL_CAMBIO"
  | "SIN_SESION_ABIERTA"
  | "MEDIO_NO_HABILITADO"
  | "COBRO_NO_CUADRA"
  | "COBRO_SIN_RENGLONES"
  | "COBRO_CON_DEMASIADOS_RENGLONES"
  | "IMPORTE_INVALIDO"
  | "CUENTA_DE_COBRO_NO_ADMITIDA"
  | "CUENTA_DE_COBRO_NO_ENCONTRADA"
  | "CUENTA_DE_COBRO_DE_OTRA_SUCURSAL"
  | "CUENTA_DE_COBRO_INACTIVA"
  | "CUENTA_DE_COBRO_INCOMPATIBLE"
  | "DATO_DE_COBRO_NO_HABILITADO"
  | "DATO_DE_COBRO_INVALIDO";
/** `totalActualEnCentavos` con `TOTAL_CAMBIO`; `falta` y `sobra` (centavos) con `COBRO_NO_CUADRA`; `dato` con los dos `DATO_DE_COBRO_*` (y `motivo` con `_INVALIDO`). */
export type ResultadoCobrarCuenta =
  | Exito<{ cobranzaId: string; yaExistia: boolean }>
  | (Fracaso<CodigoDeFalloDeCobro> & { totalActualEnCentavos?: bigint; faltaEnCentavos?: bigint; sobraEnCentavos?: bigint; cobranzaId?: string; dato?: DatoDelCobro; motivo?: MotivoDeDatoInvalido });

export type CodigoDeFalloDeCierre = "SESION_NO_ENCONTRADA" | "SESION_CERRADA" | "CONTEO_INVALIDO" | "CONFORME_FALTANTE";
export type ResultadoCerrarSesion = Exito<{ sesionId: string; yaEstabaCerrada: boolean; diferenciaEnEfectivoEnCentavos: bigint }> | Fracaso<CodigoDeFalloDeCierre>;

// ----- Etapa C3: cuentas de cobro y medios de pago -----

export interface ComandoCrearCuentaDeCobro {
  /** TERMINAL, QR o CUENTA_BANCARIA (se valida en el caso de uso: llega de afuera). */
  tipo: string;
  nombre: string;
  /** El número de terminal o el alias; `null` = sin dato. Nunca una credencial. */
  identificadorExterno: string | null;
  sucursalId: string;
}

export interface ComandoEditarCuentaDeCobro {
  cuentaDeCobroId: string;
  /** La versión que la pantalla tenía al abrir la ficha (control de versión optimista). */
  versionEsperada: number;
  nombre: string;
  identificadorExterno: string | null;
  sucursalId: string;
}

export interface ComandoCambiarEstadoDeCuentaDeCobro {
  cuentaDeCobroId: string;
}

export interface ComandoCrearMedioDePago {
  tipo: string;
  /** `null` = sin nombre propio: la pantalla usa el vocabulario del tipo. */
  nombre: string | null;
}

export interface ComandoEditarMedioDePago {
  medioDePagoId: string;
  versionEsperada: number;
  nombre: string | null;
  /** El conjunto FINAL de datos que pide el medio, no solo lo que cambia. */
  datos: DatosQuePideElMedio;
}

export interface ComandoCambiarEstadoDeMedioDePago {
  medioDePagoId: string;
}

type CodigoComunDeConfiguracion = "VERSION_DESACTUALIZADA" | "SUCURSAL_NO_ENCONTRADA" | "SUCURSAL_FUERA_DE_ALCANCE";

export type CodigoDeFalloDeCrearCuenta = "TIPO_DE_CUENTA_INVALIDO" | "NOMBRE_DE_CUENTA_INVALIDO" | "IDENTIFICADOR_EXTERNO_INVALIDO" | "CUENTA_DUPLICADA" | Exclude<CodigoComunDeConfiguracion, "VERSION_DESACTUALIZADA">;
export type ResultadoCrearCuentaDeCobro = Exito<{ cuentaDeCobroId: string; yaExistia: boolean }> | Fracaso<CodigoDeFalloDeCrearCuenta>;

export type CodigoDeFalloDeEditarCuenta = "NOMBRE_DE_CUENTA_INVALIDO" | "IDENTIFICADOR_EXTERNO_INVALIDO" | "CUENTA_DE_COBRO_NO_ENCONTRADA" | "CUENTA_DUPLICADA" | CodigoComunDeConfiguracion;
export type ResultadoEditarCuentaDeCobro = Exito<{ version: number }> | Fracaso<CodigoDeFalloDeEditarCuenta>;

export type CodigoDeFalloDeEstadoDeCuenta = "CUENTA_DE_COBRO_NO_ENCONTRADA" | "SUCURSAL_FUERA_DE_ALCANCE";
export type ResultadoDesactivarCuentaDeCobro = Exito<{ yaEstabaInactiva: boolean }> | Fracaso<CodigoDeFalloDeEstadoDeCuenta>;
export type ResultadoReactivarCuentaDeCobro = Exito<{ yaEstabaActiva: boolean }> | Fracaso<CodigoDeFalloDeEstadoDeCuenta>;

export type CodigoDeFalloDeCrearMedio = "TIPO_DE_MEDIO_INVALIDO" | "NOMBRE_DE_MEDIO_INVALIDO" | "MEDIO_DUPLICADO" | "MEDIO_INACTIVO_CON_ESE_NOMBRE" | "EFECTIVO_YA_EXISTE";
export type ResultadoCrearMedioDePago = Exito<{ medioDePagoId: string; yaExistia: boolean }> | Fracaso<CodigoDeFalloDeCrearMedio>;

export type CodigoDeFalloDeEditarMedio = "NOMBRE_DE_MEDIO_INVALIDO" | "MEDIO_NO_ENCONTRADO" | "MEDIO_DUPLICADO" | "VERSION_DESACTUALIZADA" | "DATO_NO_ADMITIDO_POR_EL_MEDIO";
/** `dato` con `DATO_NO_ADMITIDO_POR_EL_MEDIO`: el primero que el tipo no admite. */
export type ResultadoEditarMedioDePago = Exito<{ version: number }> | (Fracaso<CodigoDeFalloDeEditarMedio> & { dato?: DatoDelCobro });

export type CodigoDeFalloDeEstadoDeMedio = "MEDIO_NO_ENCONTRADO" | "EFECTIVO_NO_SE_DESACTIVA";
export type ResultadoDesactivarMedioDePago = Exito<{ yaEstabaInactivo: boolean }> | Fracaso<CodigoDeFalloDeEstadoDeMedio>;
export type ResultadoReactivarMedioDePago = Exito<{ yaEstabaActivo: boolean }> | Fracaso<Exclude<CodigoDeFalloDeEstadoDeMedio, "EFECTIVO_NO_SE_DESACTIVA">>;
