import type { ConteoDeBilletes, RenglonDeCobro } from "@/core/caja/public";
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

export type CodigoDeFalloDeMovimiento = "CLAVE_REUTILIZADA" | "SESION_NO_ENCONTRADA" | "SESION_CERRADA" | "CAJA_EN_CIERRE";
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
  | "CAJA_EN_CIERRE"
  | "MEDIO_NO_HABILITADO"
  | "COBRO_NO_CUADRA"
  | "COBRO_SIN_RENGLONES"
  | "COBRO_CON_DEMASIADOS_RENGLONES"
  | "IMPORTE_INVALIDO";
/** `totalActualEnCentavos` con `TOTAL_CAMBIO`; `falta` y `sobra` (centavos) con `COBRO_NO_CUADRA`; `sesionId` con `CAJA_EN_CIERRE`. */
export type ResultadoCobrarCuenta =
  | Exito<{ cobranzaId: string; yaExistia: boolean }>
  | (Fracaso<CodigoDeFalloDeCobro> & { totalActualEnCentavos?: bigint; faltaEnCentavos?: bigint; sobraEnCentavos?: bigint; cobranzaId?: string; sesionId?: string });

export interface ComandoIniciarCierre {
  sesionId: string;
}
export type CodigoDeFalloDeCambioDeCierre = "SESION_NO_ENCONTRADA" | "SESION_CERRADA";
/** `yaEstabaEnCierre`: repetir no escribe ni audita (idempotente por estado). */
export type ResultadoIniciarCierre = Exito<{ sesionId: string; yaEstabaEnCierre: boolean }> | Fracaso<CodigoDeFalloDeCambioDeCierre>;

export interface ComandoCancelarCierre {
  sesionId: string;
}
/** `yaEstabaAbierta`: repetir no escribe ni audita (idempotente por estado). */
export type ResultadoCancelarCierre = Exito<{ sesionId: string; yaEstabaAbierta: boolean }> | Fracaso<CodigoDeFalloDeCambioDeCierre>;

export type CodigoDeFalloDeCierre = "SESION_NO_ENCONTRADA" | "SESION_CERRADA" | "SESION_NO_EN_CIERRE" | "CONTEO_INVALIDO" | "CONFORME_FALTANTE";
export type ResultadoCerrarSesion = Exito<{ sesionId: string; yaEstabaCerrada: boolean; diferenciaEnEfectivoEnCentavos: bigint }> | Fracaso<CodigoDeFalloDeCierre>;
