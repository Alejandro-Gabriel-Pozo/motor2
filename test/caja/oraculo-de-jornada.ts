/**
 * ORÁCULO DE COMBINACIONES de la jornada y el cierre del día (caja C2). Escrito APARTE del código (regla del dueño, 2026-10-28, `docs/mapa-cobertura-de-combinaciones-2026-10-28.md`): son tablas de DATOS legibles, no `if`; los tests recorren
 * todas las combinaciones contra ellas y el guardián (`oraculo-de-jornada.test.ts`) falla si aparece una dimensión nueva sin declarar acá. Diseño: `docs/diseno-caja-c2-jornada-y-cierre-del-dia-2026-11-16.md` §5.
 * Fuente de cada fila: la ficha del concepto «Cierre del día» y la especificación e3b de Pedernal (decisiones 160, 163, 164, 167 y 168 del dueño de Pedernal), y el diseño de C2.
 */

export type EstadoDeLaJornada = "SIN_ACTIVIDAD" | "ABIERTA" | "EN_AUDITORIA" | "CERRADA";

export const ESTADOS_A_RECORRER: readonly EstadoDeLaJornada[] = ["SIN_ACTIVIDAD", "ABIERTA", "EN_AUDITORIA", "CERRADA"];

/** `NO_APLICA`: la combinación no puede darse (por ejemplo, un cobro cuya jornada no existe: la jornada nace con la sesión que cobra). */
export type Esperado = "OK" | "NO_APLICA" | string;

export const COMANDOS_DE_JORNADA = ["abrirSesion", "cobrarCuenta", "iniciarAuditoria", "cancelarAuditoria", "corregirMedioDeCobro", "declararTotal", "darConformeGeneral", "cerrarJornada"] as const;
export type ComandoDeJornada = (typeof COMANDOS_DE_JORNADA)[number];

/**
 * estado de la jornada × comando → lo esperado (`OK`, el código de rechazo o `NO_APLICA`). `iniciarAuditoria` y `cerrarJornada` se ejecutan sin impedimentos y con la huella vista correcta; `cobrarCuenta` y `corregirMedioDeCobro`
 * necesitan una sesión y un cobro: ya existe una jornada, por eso `SIN_ACTIVIDAD` no aplica.
 */
export const ORACULO_ESTADO_POR_COMANDO: Readonly<Record<ComandoDeJornada, Readonly<Record<EstadoDeLaJornada, Esperado>>>> = {
  abrirSesion: { SIN_ACTIVIDAD: "OK", ABIERTA: "OK", EN_AUDITORIA: "JORNADA_EN_AUDITORIA", CERRADA: "JORNADA_CERRADA" },
  cobrarCuenta: { SIN_ACTIVIDAD: "NO_APLICA", ABIERTA: "OK", EN_AUDITORIA: "JORNADA_EN_AUDITORIA", CERRADA: "JORNADA_CERRADA" },
  iniciarAuditoria: { SIN_ACTIVIDAD: "JORNADA_NO_ENCONTRADA", ABIERTA: "OK", EN_AUDITORIA: "OK", CERRADA: "JORNADA_CERRADA" },
  cancelarAuditoria: { SIN_ACTIVIDAD: "JORNADA_NO_ENCONTRADA", ABIERTA: "OK", EN_AUDITORIA: "OK", CERRADA: "JORNADA_CERRADA" },
  corregirMedioDeCobro: { SIN_ACTIVIDAD: "NO_APLICA", ABIERTA: "JORNADA_NO_EN_AUDITORIA", EN_AUDITORIA: "OK", CERRADA: "JORNADA_CERRADA" },
  declararTotal: { SIN_ACTIVIDAD: "JORNADA_NO_ENCONTRADA", ABIERTA: "JORNADA_NO_EN_AUDITORIA", EN_AUDITORIA: "OK", CERRADA: "JORNADA_CERRADA" },
  darConformeGeneral: { SIN_ACTIVIDAD: "JORNADA_NO_ENCONTRADA", ABIERTA: "JORNADA_NO_EN_AUDITORIA", EN_AUDITORIA: "OK", CERRADA: "JORNADA_CERRADA" },
  // Una jornada ya cerrada con ESTE mismo pedido (misma huella, mismas explicaciones) responde `OK` (`yaEstabaCerrada`); con otro pedido, `JORNADA_CERRADA`.
  cerrarJornada: { SIN_ACTIVIDAD: "JORNADA_NO_ENCONTRADA", ABIERTA: "JORNADA_NO_EN_AUDITORIA", EN_AUDITORIA: "OK", CERRADA: "OK" },
};

/** Repetir el comando dos veces seguidas sobre la misma jornada: lo esperado de la SEGUNDA vez (no escribe ni audita de nuevo cuando es `YA_ESTABA`). */
export const ORACULO_REPETICION: Readonly<Record<"iniciarAuditoria" | "cancelarAuditoria" | "cerrarJornada", { primera: string; segunda: string; yaEstaba: string }>> = {
  iniciarAuditoria: { primera: "OK", segunda: "OK", yaEstaba: "yaEstabaEnAuditoria" },
  cancelarAuditoria: { primera: "OK", segunda: "OK", yaEstaba: "yaEstabaAbierta" },
  cerrarJornada: { primera: "OK", segunda: "OK", yaEstaba: "yaEstabaCerrada" },
};

// ===== registrarAjuste: permiso × sesión × jornada que corrige =====

/** La jornada que el ajuste dice corregir, respecto de la de la sesión donde se registra, y el estado de esa jornada. */
export type JornadaACorregir = "anterior_SIN_ACTIVIDAD" | "anterior_ABIERTA" | "anterior_EN_AUDITORIA" | "anterior_CERRADA" | "igual_ABIERTA" | "posterior_CERRADA";

export interface FilaDeAjuste {
  readonly puedeAjustar: boolean;
  readonly sesion: "ABIERTA" | "CERRADA";
  readonly jornada: JornadaACorregir;
  readonly esperado: Esperado;
}

/**
 * Las 24 combinaciones. Orden de precedencia (el primero que falla manda): sin permiso → cierra por defecto antes de mirar nada; después, que la jornada que se corrige exista, esté CERRADA y sea anterior; recién después, que la sesión esté abierta.
 * Solo es `OK` con permiso, sesión abierta y una jornada anterior ya cerrada.
 */
export const ORACULO_DE_AJUSTE: readonly FilaDeAjuste[] = [
  { puedeAjustar: false, sesion: "ABIERTA", jornada: "anterior_SIN_ACTIVIDAD", esperado: "SIN_PERMISO_PARA_AJUSTAR" },
  { puedeAjustar: false, sesion: "ABIERTA", jornada: "anterior_ABIERTA", esperado: "SIN_PERMISO_PARA_AJUSTAR" },
  { puedeAjustar: false, sesion: "ABIERTA", jornada: "anterior_EN_AUDITORIA", esperado: "SIN_PERMISO_PARA_AJUSTAR" },
  { puedeAjustar: false, sesion: "ABIERTA", jornada: "anterior_CERRADA", esperado: "SIN_PERMISO_PARA_AJUSTAR" },
  { puedeAjustar: false, sesion: "ABIERTA", jornada: "igual_ABIERTA", esperado: "SIN_PERMISO_PARA_AJUSTAR" },
  { puedeAjustar: false, sesion: "ABIERTA", jornada: "posterior_CERRADA", esperado: "SIN_PERMISO_PARA_AJUSTAR" },
  { puedeAjustar: false, sesion: "CERRADA", jornada: "anterior_SIN_ACTIVIDAD", esperado: "SIN_PERMISO_PARA_AJUSTAR" },
  { puedeAjustar: false, sesion: "CERRADA", jornada: "anterior_ABIERTA", esperado: "SIN_PERMISO_PARA_AJUSTAR" },
  { puedeAjustar: false, sesion: "CERRADA", jornada: "anterior_EN_AUDITORIA", esperado: "SIN_PERMISO_PARA_AJUSTAR" },
  { puedeAjustar: false, sesion: "CERRADA", jornada: "anterior_CERRADA", esperado: "SIN_PERMISO_PARA_AJUSTAR" },
  { puedeAjustar: false, sesion: "CERRADA", jornada: "igual_ABIERTA", esperado: "SIN_PERMISO_PARA_AJUSTAR" },
  { puedeAjustar: false, sesion: "CERRADA", jornada: "posterior_CERRADA", esperado: "SIN_PERMISO_PARA_AJUSTAR" },
  { puedeAjustar: true, sesion: "ABIERTA", jornada: "anterior_SIN_ACTIVIDAD", esperado: "JORNADA_A_CORREGIR_NO_ENCONTRADA" },
  { puedeAjustar: true, sesion: "ABIERTA", jornada: "anterior_ABIERTA", esperado: "JORNADA_A_CORREGIR_NO_CERRADA" },
  { puedeAjustar: true, sesion: "ABIERTA", jornada: "anterior_EN_AUDITORIA", esperado: "JORNADA_A_CORREGIR_NO_CERRADA" },
  { puedeAjustar: true, sesion: "ABIERTA", jornada: "anterior_CERRADA", esperado: "OK" },
  { puedeAjustar: true, sesion: "ABIERTA", jornada: "igual_ABIERTA", esperado: "JORNADA_A_CORREGIR_NO_CERRADA" },
  { puedeAjustar: true, sesion: "ABIERTA", jornada: "posterior_CERRADA", esperado: "JORNADA_A_CORREGIR_NO_ANTERIOR" },
  { puedeAjustar: true, sesion: "CERRADA", jornada: "anterior_SIN_ACTIVIDAD", esperado: "JORNADA_A_CORREGIR_NO_ENCONTRADA" },
  { puedeAjustar: true, sesion: "CERRADA", jornada: "anterior_ABIERTA", esperado: "JORNADA_A_CORREGIR_NO_CERRADA" },
  { puedeAjustar: true, sesion: "CERRADA", jornada: "anterior_EN_AUDITORIA", esperado: "JORNADA_A_CORREGIR_NO_CERRADA" },
  { puedeAjustar: true, sesion: "CERRADA", jornada: "anterior_CERRADA", esperado: "SESION_CERRADA" },
  { puedeAjustar: true, sesion: "CERRADA", jornada: "igual_ABIERTA", esperado: "JORNADA_A_CORREGIR_NO_CERRADA" },
  { puedeAjustar: true, sesion: "CERRADA", jornada: "posterior_CERRADA", esperado: "JORNADA_A_CORREGIR_NO_ANTERIOR" },
];

// ===== Controles: severidad × hallazgos × reconocido → ¿permite cerrar? =====

export type SeveridadDeControl = "BLOQUEA" | "RECONOCIBLE" | "INFORMA";

export interface FilaDeSeveridad {
  readonly severidad: SeveridadDeControl;
  readonly conHallazgos: boolean;
  readonly reconocido: boolean;
  /** `OK`, o el código con el que `decidirCierre` rechaza. */
  readonly esperado: "OK" | "CONTROLES_QUE_BLOQUEAN" | "CONTROLES_SIN_RECONOCER" | "RECONOCIMIENTO_INVALIDO";
}

/** Las 12 combinaciones (3 severidades × con o sin hallazgos × reconocido o no). Reconocer solo vale para un control RECONOCIBLE con hallazgos: cualquier otro reconocimiento es inválido (decisión 167). */
export const ORACULO_DE_SEVERIDAD: readonly FilaDeSeveridad[] = [
  { severidad: "BLOQUEA", conHallazgos: false, reconocido: false, esperado: "OK" },
  { severidad: "BLOQUEA", conHallazgos: false, reconocido: true, esperado: "RECONOCIMIENTO_INVALIDO" },
  { severidad: "BLOQUEA", conHallazgos: true, reconocido: false, esperado: "CONTROLES_QUE_BLOQUEAN" },
  { severidad: "BLOQUEA", conHallazgos: true, reconocido: true, esperado: "RECONOCIMIENTO_INVALIDO" },
  { severidad: "RECONOCIBLE", conHallazgos: false, reconocido: false, esperado: "OK" },
  { severidad: "RECONOCIBLE", conHallazgos: false, reconocido: true, esperado: "RECONOCIMIENTO_INVALIDO" },
  { severidad: "RECONOCIBLE", conHallazgos: true, reconocido: false, esperado: "CONTROLES_SIN_RECONOCER" },
  { severidad: "RECONOCIBLE", conHallazgos: true, reconocido: true, esperado: "OK" },
  { severidad: "INFORMA", conHallazgos: false, reconocido: false, esperado: "OK" },
  { severidad: "INFORMA", conHallazgos: false, reconocido: true, esperado: "RECONOCIMIENTO_INVALIDO" },
  { severidad: "INFORMA", conHallazgos: true, reconocido: false, esperado: "OK" },
  { severidad: "INFORMA", conHallazgos: true, reconocido: true, esperado: "RECONOCIMIENTO_INVALIDO" },
];

/** La severidad fija de cada control (decisión 167 de Pedernal y diseño de C2): quién impide, quién se reconoce y quién solo informa. */
export const ORACULO_DE_CONTROLES: Readonly<Record<string, SeveridadDeControl>> = {
  "caja.sesiones_sin_cerrar": "BLOQUEA",
  "caja.diferencia_de_arqueo": "RECONOCIBLE",
  "caja.conciliacion_por_medio": "RECONOCIBLE",
  "caja.cobrado_contra_ticket": "RECONOCIBLE",
  "caja.cobros_corregidos": "INFORMA",
  "caja.ajustes_a_jornadas_cerradas": "INFORMA",
  "ventas.cuentas_abiertas": "BLOQUEA",
  "ventas.tickets_por_cobrar": "RECONOCIBLE",
};

// ===== Fecha de negocio: instante × hora de corte → fecha (zona Argentina, UTC-3 todo el año) =====

export interface FilaDeFecha {
  readonly instanteUtc: string;
  readonly corte: string;
  readonly fecha: string;
  readonly porQue: string;
}

export const ORACULO_DE_FECHA_DE_NEGOCIO: readonly FilaDeFecha[] = [
  { instanteUtc: "2026-01-15T08:59:59.999Z", corte: "06:00", fecha: "2026-01-14", porQue: "05:59:59.999 en Argentina: todavía rige la jornada anterior" },
  { instanteUtc: "2026-01-15T09:00:00.000Z", corte: "06:00", fecha: "2026-01-15", porQue: "06:00:00.000 en Argentina: empieza la jornada nueva" },
  { instanteUtc: "2026-01-15T02:59:59.999Z", corte: "00:00", fecha: "2026-01-14", porQue: "23:59:59.999 del 14 en Argentina, aunque en UTC ya sea el 15" },
  { instanteUtc: "2026-01-15T03:00:00.000Z", corte: "00:00", fecha: "2026-01-15", porQue: "00:00:00.000 del 15 en Argentina, la medianoche argentina (no la UTC)" },
  { instanteUtc: "2026-01-16T02:30:00.000Z", corte: "00:00", fecha: "2026-01-15", porQue: "23:30 del 15 en Argentina, ya es el 16 en UTC" },
  { instanteUtc: "2026-01-15T12:00:00.000Z", corte: "00:00", fecha: "2026-01-15", porQue: "mediodía UTC es 09:00 en Argentina" },
  { instanteUtc: "2026-01-01T02:59:59.999Z", corte: "00:00", fecha: "2025-12-31", porQue: "cruce de año: el 31/12 argentino" },
  { instanteUtc: "2026-01-01T07:59:59.999Z", corte: "05:00", fecha: "2025-12-31", porQue: "cruce de año con corte 05:00: 04:59 del 1/1 es todavía el 31/12" },
  { instanteUtc: "2026-03-01T02:59:59.999Z", corte: "00:00", fecha: "2026-02-28", porQue: "fin de febrero (2026 no es bisiesto)" },
  { instanteUtc: "2028-03-01T05:59:59.999Z", corte: "04:00", fecha: "2028-02-29", porQue: "29/02 de un año bisiesto con corte 04:00: 02:59 del 1/3 es todavía el 29/02" },
  { instanteUtc: "2026-01-15T11:59:00.000Z", corte: "23:59", fecha: "2026-01-14", porQue: "corte 23:59: casi todo el día es de la jornada anterior (08:59 del 15 → jornada del 14)" },
  { instanteUtc: "2026-01-16T02:59:00.000Z", corte: "23:59", fecha: "2026-01-15", porQue: "23:59 en punto del 15: ya es la jornada del 15" },
];

// ===== Guardián: columnas de las tablas nuevas y de lo que C2 tocó, con su declaración «afecta / no afecta» =====

/** Declaración de cada columna: ¿cambia dinero, permisos, visibilidad o stock? `motivo` es por qué. Una columna nueva sin entrada acá hace fallar al guardián. */
export const COLUMNAS_DECLARADAS: Readonly<Record<string, Readonly<Record<string, { afecta: boolean; motivo: string }>>>> = {
  JornadaDeSucursal: {
    id: { afecta: false, motivo: "identidad" },
    empresaId: { afecta: true, motivo: "aislamiento por empresa (RLS)" },
    sucursalId: { afecta: true, motivo: "aislamiento por sucursal (RLS)" },
    fechaDeNegocio: { afecta: true, motivo: "decide a qué día pertenece lo cobrado" },
    estado: { afecta: true, motivo: "decide si se cobra, se abre caja o se corrige: tabla de estado × comando" },
    auditoriaIniciadaEn: { afecta: false, motivo: "constancia de quién y cuándo; sigue al estado por CHECK" },
    auditoriaIniciadaPorId: { afecta: false, motivo: "constancia; sigue al estado por CHECK" },
    cerradaEn: { afecta: false, motivo: "constancia; sigue al estado por CHECK" },
    cerradaPorId: { afecta: false, motivo: "constancia; sigue al estado por CHECK" },
    huellaDeCierre: { afecta: false, motivo: "constancia de lo que se vio; no cambia ninguna regla" },
    observacion: { afecta: false, motivo: "texto libre de la lista de permitidos" },
    creadoEn: { afecta: false, motivo: "constancia" },
  },
  ControlDeJornadaCerrada: {
    id: { afecta: false, motivo: "identidad" },
    empresaId: { afecta: true, motivo: "aislamiento por empresa (RLS)" },
    sucursalId: { afecta: true, motivo: "aislamiento por sucursal (RLS)" },
    jornadaId: { afecta: false, motivo: "enlace a la jornada" },
    modulo: { afecta: false, motivo: "nombre del módulo que aporta el control" },
    clave: { afecta: true, motivo: "cada clave tiene severidad fija: oráculo de controles" },
    severidad: { afecta: true, motivo: "decide si impide, se reconoce o solo informa: oráculo de severidad" },
    cantidad: { afecta: true, motivo: "con hallazgos o sin ellos: oráculo de severidad" },
    reconocido: { afecta: true, motivo: "decide si se puede cerrar: oráculo de severidad" },
    reconocidoEn: { afecta: false, motivo: "constancia" },
    reconocidoPorId: { afecta: false, motivo: "constancia" },
    texto: { afecta: false, motivo: "explicación opcional, no cambia reglas" },
    creadoEn: { afecta: false, motivo: "constancia" },
  },
  CorreccionDeMedio: {
    id: { afecta: false, motivo: "identidad" },
    empresaId: { afecta: true, motivo: "aislamiento por empresa (RLS)" },
    sucursalId: { afecta: true, motivo: "aislamiento por sucursal (RLS)" },
    jornadaId: { afecta: true, motivo: "solo vale con la jornada EN_AUDITORIA: tabla de estado × comando" },
    cobroId: { afecta: true, motivo: "qué cobro se corrige (su importe se traslada)" },
    secuencia: { afecta: true, motivo: "rige la última; sin huecos" },
    medioAntesId: { afecta: true, motivo: "de dónde sale el importe en la conciliación" },
    medioDespuesId: { afecta: true, motivo: "adónde va el importe en la conciliación" },
    motivo: { afecta: false, motivo: "texto libre de la lista de permitidos" },
    corregidoEn: { afecta: false, motivo: "constancia" },
    corregidoPorId: { afecta: false, motivo: "constancia" },
    claveIdempotencia: { afecta: false, motivo: "reintento; no cambia el resultado" },
    huella: { afecta: false, motivo: "reintento; no cambia el resultado" },
    creadoEn: { afecta: false, motivo: "constancia" },
  },
  DeclaracionDeTotal: {
    id: { afecta: false, motivo: "identidad" },
    empresaId: { afecta: true, motivo: "aislamiento por empresa (RLS)" },
    sucursalId: { afecta: true, motivo: "aislamiento por sucursal (RLS)" },
    jornadaId: { afecta: true, motivo: "solo vale con la jornada EN_AUDITORIA: tabla de estado × comando" },
    medioDePagoId: { afecta: true, motivo: "el efectivo no se declara; los demás sí" },
    secuencia: { afecta: true, motivo: "rige la última; gana sobre el conforme general" },
    importe: { afecta: true, motivo: "es el total contra el que se calcula la diferencia" },
    declaradoEn: { afecta: false, motivo: "constancia" },
    declaradoPorId: { afecta: false, motivo: "constancia" },
    claveIdempotencia: { afecta: false, motivo: "reintento; no cambia el resultado" },
    huella: { afecta: false, motivo: "reintento; no cambia el resultado" },
    creadoEn: { afecta: false, motivo: "constancia" },
  },
  ConformeDeJornada: {
    id: { afecta: false, motivo: "identidad" },
    empresaId: { afecta: true, motivo: "aislamiento por empresa (RLS)" },
    sucursalId: { afecta: true, motivo: "aislamiento por sucursal (RLS)" },
    jornadaId: { afecta: true, motivo: "uno por jornada; solo con la jornada EN_AUDITORIA" },
    conformePorId: { afecta: false, motivo: "constancia" },
    conformeEn: { afecta: false, motivo: "constancia" },
    claveIdempotencia: { afecta: false, motivo: "reintento; no cambia el resultado" },
    huella: { afecta: false, motivo: "reintento; no cambia el resultado" },
    creadoEn: { afecta: false, motivo: "constancia" },
  },
};

/** Las columnas que C2 sumó a tablas de C1 y a `Sucursal`. */
export const COLUMNAS_SUMADAS_A_OTRAS_TABLAS: Readonly<Record<string, Readonly<Record<string, { afecta: boolean; motivo: string }>>>> = {
  Sucursal: { horaDeCorte: { afecta: true, motivo: "decide a qué jornada cae lo que pasa de madrugada: oráculo de fecha de negocio" } },
  SesionCaja: { horaDeCorte: { afecta: true, motivo: "sello con el que se calculó la fecha de negocio de la sesión: oráculo de fecha de negocio" } },
  MovimientoCaja: { corrigeJornada: { afecta: true, motivo: "enlaza un ajuste con una jornada cerrada: oráculo de ajuste" } },
};

/** Las clases de movimiento declaradas (el guardián exige que `CLASES_DE_MOVIMIENTO` no tenga una que falte acá). */
export const CLASES_DE_MOVIMIENTO_DECLARADAS = ["FONDO_INICIAL", "COBRO", "INGRESO_MANUAL", "EGRESO_MANUAL", "AJUSTE", "ANULACION"] as const;
