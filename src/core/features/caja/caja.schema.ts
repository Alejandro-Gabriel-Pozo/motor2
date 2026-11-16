import type { ConteoDeBilletes, ReconocimientoPedido, RenglonDeCobro } from "@/core/caja/public";
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

export type CodigoDeFalloDeAbrirSesion = "CLAVE_REUTILIZADA" | "SUCURSAL_INACTIVA" | "CAJA_YA_ABIERTA" | "SUCURSAL_NO_ENCONTRADA" | "JORNADA_EN_AUDITORIA" | "JORNADA_CERRADA" | "HORA_DE_CORTE_INVALIDA" | "ZONA_HORARIA_INVALIDA" | "INSTANTE_INVALIDO";
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
  | "JORNADA_EN_AUDITORIA"
  | "JORNADA_CERRADA"
  | "HORA_DE_CORTE_INVALIDA"
  | "ZONA_HORARIA_INVALIDA"
  | "INSTANTE_INVALIDO"
  | "COBRO_NO_CUADRA"
  | "COBRO_SIN_RENGLONES"
  | "COBRO_CON_DEMASIADOS_RENGLONES"
  | "IMPORTE_INVALIDO";
/** `totalActualEnCentavos` con `TOTAL_CAMBIO`; `falta` y `sobra` (centavos) con `COBRO_NO_CUADRA`. */
/** `jornadaVencida`: la sesión sigue abierta pasada su hora de corte (cobra en SU jornada, la que selló al abrir); la pantalla lo avisa. */
export type ResultadoCobrarCuenta =
  | Exito<{ cobranzaId: string; yaExistia: boolean; jornadaVencida: boolean }>
  | (Fracaso<CodigoDeFalloDeCobro> & { totalActualEnCentavos?: bigint; faltaEnCentavos?: bigint; sobraEnCentavos?: bigint; cobranzaId?: string });

export type CodigoDeFalloDeCierre = "SESION_NO_ENCONTRADA" | "SESION_CERRADA" | "CONTEO_INVALIDO" | "CONFORME_FALTANTE";
export type ResultadoCerrarSesion = Exito<{ sesionId: string; yaEstabaCerrada: boolean; diferenciaEnEfectivoEnCentavos: bigint }> | Fracaso<CodigoDeFalloDeCierre>;

// ===== Etapa C2: jornada de sucursal y cierre del día (docs/diseno-caja-c2-jornada-y-cierre-del-dia-2026-11-16.md). La sucursal es la activa del contexto; la jornada se nombra por su fecha de negocio «AAAA-MM-DD». =====

export interface ComandoDeJornada {
  fechaDeNegocio: string;
}

export interface ComandoCorregirMedioDeCobro {
  claveIdempotencia: string;
  cobroId: string;
  /** A qué medio pasa el cobro (el importe completo): cualquier otro medio activo. */
  medioDestinoId: string;
  motivo: string;
}

export interface ComandoDeclararTotal {
  claveIdempotencia: string;
  fechaDeNegocio: string;
  medioDePagoId: string;
  /** El total que dicen los comprobantes del medio: cero o más, dentro del tope. */
  importeEnCentavos: bigint;
}

export interface ComandoDarConformeGeneral {
  claveIdempotencia: string;
  fechaDeNegocio: string;
}

export interface ComandoCerrarJornada {
  fechaDeNegocio: string;
  /** La huella de los controles que mostró la pantalla: nada se cierra con algo que nadie vio. */
  huellaVista: string;
  /** Qué controles `RECONOCIBLE` con hallazgos reconoce quien cierra, con su explicación opcional. */
  reconocimientos: readonly ReconocimientoPedido[];
  observacion: string | null;
}

export interface ComandoRegistrarAjuste {
  claveIdempotencia: string;
  sesionId: string;
  medioDePagoId: string;
  /** Con signo y distinto de cero: el ajuste suma o resta al esperado del medio. */
  importeEnCentavos: bigint;
  motivo: string;
  /** «AAAA-MM-DD» de la jornada ya cerrada que este ajuste explica (obligatoria: el ajuste solo se acepta sobre un día cerrado). */
  corrigeJornada: string;
}

type CodigoDeJornada = "FECHA_INVALIDA" | "JORNADA_NO_ENCONTRADA" | "JORNADA_CERRADA";
type CodigoDeJornadaEnCierre = CodigoDeJornada | "JORNADA_NO_EN_AUDITORIA";

/** Un impedimento para empezar el cierre: un control `BLOQUEA` con hallazgos. */
export interface ImpedimentoDeJornada {
  clave: string;
  cantidad: number;
  referencias: readonly string[];
}

export type ResultadoIniciarAuditoria = Exito<{ yaEstabaEnAuditoria: boolean }> | (Fracaso<CodigoDeJornada | "JORNADA_CON_IMPEDIMENTOS"> & { impedimentos?: readonly ImpedimentoDeJornada[] });
export type ResultadoCancelarAuditoria = Exito<{ yaEstabaAbierta: boolean }> | Fracaso<CodigoDeJornada>;

export type ResultadoCorregirMedioDeCobro =
  | Exito<{ correccionId: string; secuencia: number; yaExistia: boolean }>
  | (Fracaso<CodigoDeJornadaEnCierre | "CLAVE_REUTILIZADA" | "COBRO_NO_ENCONTRADO" | "MOTIVO_INVALIDO" | "MEDIO_NO_ENCONTRADO" | "MEDIO_NO_HABILITADO" | "MEDIO_DEL_COBRO_SIN_CAMBIOS" | "MEDIO_DEL_COBRO_CAMBIO"> & { vigenteId?: string });

export type ResultadoDeclararTotal =
  | Exito<{ declaracionId: string; secuencia: number; yaExistia: boolean }>
  | Fracaso<CodigoDeJornadaEnCierre | "CLAVE_REUTILIZADA" | "MEDIO_NO_ENCONTRADO" | "MEDIO_NO_DECLARABLE" | "IMPORTE_INVALIDO">;

export type ResultadoDarConformeGeneral = Exito<{ conformeId: string; yaExistia: boolean }> | Fracaso<CodigoDeJornadaEnCierre | "CLAVE_REUTILIZADA">;

/** Un control tal como lo ve quien cierra, o como quedó en la foto de la jornada cerrada. */
export interface ControlDeJornadaVisto {
  clave: string;
  severidad: "BLOQUEA" | "RECONOCIBLE" | "INFORMA";
  cantidad: number;
  reconocido: boolean;
  texto: string | null;
}

export type ResultadoCerrarJornada =
  | Exito<{ controles: readonly ControlDeJornadaVisto[]; yaEstabaCerrada: boolean }>
  | (Fracaso<CodigoDeJornadaEnCierre | "OBSERVACION_INVALIDA" | "RECONOCIMIENTO_INVALIDO" | "CONTROLES_CAMBIARON" | "CONTROLES_QUE_BLOQUEAN" | "CONTROLES_SIN_RECONOCER"> & {
      /** Con `CONTROLES_CAMBIARON`: los controles de ahora (la pantalla vuelve a mostrarlos) y su huella. */
      controles?: readonly ControlDeJornadaVisto[];
      huellaActual?: string;
      /** Con `CONTROLES_QUE_BLOQUEAN` o `CONTROLES_SIN_RECONOCER`: las claves involucradas. */
      claves?: readonly string[];
    });

export type ResultadoRegistrarAjuste =
  | Exito<{ movimientoId: string; yaExistia: boolean }>
  | Fracaso<
      | "CLAVE_REUTILIZADA"
      | "SIN_PERMISO_PARA_AJUSTAR"
      | "SESION_NO_ENCONTRADA"
      | "SESION_CERRADA"
      | "MEDIO_NO_HABILITADO"
      | "IMPORTE_INVALIDO"
      | "MOTIVO_INVALIDO"
      | "FECHA_INVALIDA"
      | "JORNADA_A_CORREGIR_NO_ENCONTRADA"
      | "JORNADA_A_CORREGIR_NO_CERRADA"
      | "JORNADA_A_CORREGIR_NO_ANTERIOR"
    >;
