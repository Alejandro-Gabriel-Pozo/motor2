/**
 * Envío de mails (E3, ADR-018). Interfaz propia del núcleo: nada de afuera conoce a Resend.
 *
 * Dos canales con configuración separada (cuenta, clave y dominio propios, para que el cupo de uno no deje sin mails al otro):
 * - `avisos`: invitaciones, avisos de la app y códigos de ingreso de la plataforma.
 * - `operativo`: los mails del módulo de hoteles (solicitudes a administración, rechazos, avisos de pago).
 */
export const CANALES_DE_CORREO = ["avisos", "operativo"] as const;
export type CanalDeCorreo = (typeof CANALES_DE_CORREO)[number];

export interface MensajeDeCorreo {
  para: readonly string[];
  asunto: string;
  texto: string;
  html?: string;
  responderA?: string;
  /** Mismo valor = mismo mail: el proveedor descarta el reenvío (Resend lo recuerda 24 horas). Para reintentos del canal operativo. */
  claveDeIdempotencia?: string;
}

/**
 * Por qué falló un envío, para decidir qué hacer:
 * - `CUPO`: se agotó el cupo diario o mensual de la cuenta; reintentar recién cuando se renueve (al día siguiente).
 * - `TRANSITORIO`: falla del proveedor o de la red; vale reintentar enseguida.
 * - `DEFINITIVO`: el pedido es inválido o la configuración está mal; reintentar igual no sirve.
 */
export type MotivoDeFalloDeCorreo = "CUPO" | "TRANSITORIO" | "DEFINITIVO";

/** `detalle` nunca lleva el contenido del mail, destinatarios, códigos ni tokens: solo canal, estado y nombre del error. */
export type ResultadoDeEnvio = { ok: true; idExterno: string | null } | { ok: false; motivo: MotivoDeFalloDeCorreo; detalle: string };

export interface EnviadorDeCorreo {
  readonly implementacion: "resend" | "consola" | "memoria" | "sin-configurar";
  /** No lanza: todo fallo vuelve como `ResultadoDeEnvio` con `ok: false`. */
  enviar(mensaje: MensajeDeCorreo): Promise<ResultadoDeEnvio>;
}
