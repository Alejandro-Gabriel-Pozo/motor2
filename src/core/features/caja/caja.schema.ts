import type { ConteoDeBilletes, RenglonDeCobro } from "@/core/caja/public";
import type { Exito, Fracaso } from "@/core/resultado-caso";

/**
 * Tipos de la feature «caja» (etapa C1, docs/diseno-caja-y-cobro-paridad-pedernal-2026-11-16.md): los comandos ya validados y los resultados de los casos de uso de `src/server/actions/caja/`. Todo error es un CÓDIGO estable
 * (la pantalla lo traduce a texto). El dinero viaja en CENTAVOS enteros (`bigint`), nunca como `number` decimal.
 */

/**
 * Lo que la pantalla le manda a cada Server Action ANTES de validarse (el navegador puede mandar cualquier cosa: los guards de `caja.guard.ts` lo juzgan campo por campo). Los importes viajan como TEXTO decimal
 * («1234.56», a lo sumo 2 decimales), nunca como número: el guard los pasa a centavos enteros sin pasar por `number`.
 */
export interface EntradaDeAbrirSesion {
  claveIdempotencia: string;
  /** El fondo inicial en pesos como texto decimal; admite «0». */
  fondo: string;
}

export interface EntradaDeMovimientoManual {
  claveIdempotencia: string;
  sesionId: string;
  sentido: "INGRESO" | "EGRESO";
  importe: string;
  motivo: string;
}

export interface EntradaDeAnularMovimiento {
  claveIdempotencia: string;
  movimientoId: string;
  motivo: string;
}

export interface EntradaDeCobrarCuenta {
  claveIdempotencia: string;
  cuentaId: string;
  /** El total que vio quien cobra, en pesos como texto decimal. */
  totalVisto: string;
  renglones: readonly { medioDePagoId: string; importe: string }[];
}

export interface EntradaDeCerrarSesion {
  sesionId: string;
  /** Cantidad de billetes por denominación en pesos («20000», «10000»… «10»); las que faltan valen 0. */
  billetes: Readonly<Record<string, number>>;
  /** Las monedas en pesos como texto decimal; admite «0». */
  monedas: string;
  conformeDeLosDemasMedios: boolean;
  observacion: string | null;
}

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
  | "IMPORTE_INVALIDO";
/** `totalActualEnCentavos` con `TOTAL_CAMBIO`; `falta` y `sobra` (centavos) con `COBRO_NO_CUADRA`. */
export type ResultadoCobrarCuenta =
  | Exito<{ cobranzaId: string; yaExistia: boolean }>
  | (Fracaso<CodigoDeFalloDeCobro> & { totalActualEnCentavos?: bigint; faltaEnCentavos?: bigint; sobraEnCentavos?: bigint; cobranzaId?: string });

export type CodigoDeFalloDeCierre = "SESION_NO_ENCONTRADA" | "SESION_CERRADA" | "CONTEO_INVALIDO" | "CONFORME_FALTANTE";
export type ResultadoCerrarSesion = Exito<{ sesionId: string; yaEstabaCerrada: boolean; diferenciaEnEfectivoEnCentavos: bigint }> | Fracaso<CodigoDeFalloDeCierre>;
