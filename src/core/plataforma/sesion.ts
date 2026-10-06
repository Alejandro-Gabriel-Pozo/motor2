/**
 * Vigencia de la sesión de la consola de plataforma (ADR-012 §2): 8 horas como máximo desde que se creó y 30 minutos sin actividad.
 * La sesión vive en la base (no es un token autocontenido): se puede cerrar desde el servidor y la inactividad se anota sin reemitir la cookie.
 * El tiempo siempre entra por parámetro.
 */
export const DURACION_MAXIMA_DE_SESION_MS = 8 * 60 * 60 * 1000;
export const INACTIVIDAD_MAXIMA_MS = 30 * 60 * 1000;
/** La actividad se anota como mucho una vez por minuto: una escritura por pedido no aporta nada a un límite de 30 minutos. */
export const INTERVALO_DE_ACTIVIDAD_MS = 60 * 1000;
/** Entre verificar el código del mail y verificar el TOTP puede pasar como mucho esto: la sesión «pendiente» (sin segundo factor) no vale para nada más y vence sola. */
export const VIDA_DE_SESION_PENDIENTE_MS = 10 * 60 * 1000;

export interface EstadoDeSesion {
  creadaEn: Date;
  ultimaActividad: Date;
  /** Cierre explícito (salir, cambio de factor, revocación): una sesión cerrada no vuelve a valer. */
  cerradaEn: Date | null;
}

export type MotivoDeSesionInvalida = "CERRADA" | "DURACION_MAXIMA" | "INACTIVIDAD";

/** `null` si la sesión sigue vigente; si no, el motivo. */
export function motivoDeSesionInvalida(sesion: EstadoDeSesion, ahora: Date): MotivoDeSesionInvalida | null {
  if (sesion.cerradaEn !== null) return "CERRADA";
  if (ahora.getTime() - sesion.creadaEn.getTime() >= DURACION_MAXIMA_DE_SESION_MS) return "DURACION_MAXIMA";
  if (ahora.getTime() - sesion.ultimaActividad.getTime() >= INACTIVIDAD_MAXIMA_MS) return "INACTIVIDAD";
  return null;
}

export function sesionVigente(sesion: EstadoDeSesion, ahora: Date): boolean {
  return motivoDeSesionInvalida(sesion, ahora) === null;
}

export function sesionPendienteVigente(sesion: Pick<EstadoDeSesion, "creadaEn" | "cerradaEn">, ahora: Date): boolean {
  return sesion.cerradaEn === null && ahora.getTime() - sesion.creadaEn.getTime() < VIDA_DE_SESION_PENDIENTE_MS;
}

export function debeAnotarActividad(sesion: Pick<EstadoDeSesion, "ultimaActividad">, ahora: Date): boolean {
  return ahora.getTime() - sesion.ultimaActividad.getTime() >= INTERVALO_DE_ACTIVIDAD_MS;
}

/** Vence la cookie cuando vence lo primero que llegue: el tope de 8 horas (la inactividad la decide la base). */
export function vencimientoDeSesion(creadaEn: Date): Date {
  return new Date(creadaEn.getTime() + DURACION_MAXIMA_DE_SESION_MS);
}
