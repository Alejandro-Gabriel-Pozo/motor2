import type { ConteoDeBilletes, DatoDelCobro, DatosQuePideElMedio, MotivoDeDatoInvalido, ReconocimientoPedido, RenglonDeCobro } from "@/core/caja/public";
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

/** Lo que manda la pantalla para iniciar o cancelar el cierre de una sesión (C1b): solo cuál sesión. */
export interface EntradaDeCierreDeSesion {
  sesionId: string;
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

export type CodigoDeFalloDeAbrirSesion = "CLAVE_REUTILIZADA" | "SUCURSAL_INACTIVA" | "CAJA_YA_ABIERTA" | "SUCURSAL_NO_ENCONTRADA" | "JORNADA_EN_AUDITORIA" | "JORNADA_CERRADA" | "HORA_DE_CORTE_INVALIDA" | "ZONA_HORARIA_INVALIDA" | "INSTANTE_INVALIDO";
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
  | "JORNADA_EN_AUDITORIA"
  | "JORNADA_CERRADA"
  | "HORA_DE_CORTE_INVALIDA"
  | "ZONA_HORARIA_INVALIDA"
  | "INSTANTE_INVALIDO"
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
/** `totalActualEnCentavos` con `TOTAL_CAMBIO`; `falta` y `sobra` (centavos) con `COBRO_NO_CUADRA`; `dato` con los dos `DATO_DE_COBRO_*` (y `motivo` con `_INVALIDO`); `sesionId` con `CAJA_EN_CIERRE`. */
/** `jornadaVencida`: la sesión sigue abierta pasada su hora de corte (cobra en SU jornada, la que selló al abrir); la pantalla lo avisa. */
export type ResultadoCobrarCuenta =
  | Exito<{ cobranzaId: string; yaExistia: boolean; jornadaVencida: boolean }>
  | (Fracaso<CodigoDeFalloDeCobro> & { totalActualEnCentavos?: bigint; faltaEnCentavos?: bigint; sobraEnCentavos?: bigint; cobranzaId?: string; sesionId?: string; dato?: DatoDelCobro; motivo?: MotivoDeDatoInvalido });

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
      | "CAJA_EN_CIERRE"
      | "MEDIO_NO_HABILITADO"
      | "IMPORTE_INVALIDO"
      | "MOTIVO_INVALIDO"
      | "FECHA_INVALIDA"
      | "JORNADA_A_CORREGIR_NO_ENCONTRADA"
      | "JORNADA_A_CORREGIR_NO_CERRADA"
      | "JORNADA_A_CORREGIR_NO_ANTERIOR"
    >;
