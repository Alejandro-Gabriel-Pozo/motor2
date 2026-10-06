import { reportarErrorUnaVez } from "@/lib/reportar-error";
import { configuracionDelCanal } from "./configuracion";
import { esDireccionValida } from "./direcciones";
import { crearEnviadorResend } from "./resend";
import { crearEnviadorDeConsola, crearEnviadorEnMemoria, crearEnviadorSinConfigurar, type EnviadorEnMemoria } from "./locales";
import type { CanalDeCorreo, EnviadorDeCorreo, MensajeDeCorreo, ResultadoDeEnvio } from "./tipos";

type Entorno = Record<string, string | undefined>;

const enMemoria = new Map<CanalDeCorreo, EnviadorEnMemoria>();

/** El enviador en memoria de un canal (el mismo siempre): lo que los tests de quien manda mails leen en `enviados`. */
export function enviadorEnMemoriaDelCanal(canal: CanalDeCorreo): EnviadorEnMemoria {
  let enviador = enMemoria.get(canal);
  if (!enviador) {
    enviador = crearEnviadorEnMemoria();
    enMemoria.set(canal, enviador);
  }
  return enviador;
}

/**
 * Qué implementación usa un canal, en este orden:
 * 1. Tests (`NODE_ENV=test`): memoria, aunque haya claves en el entorno — un test nunca manda un mail de verdad.
 * 2. Con clave y remitente del canal: Resend (producción, y también Preview si se cargaron).
 * 3. Dentro de Vercel (`VERCEL`) sin configuración: no envía y lo informa. Nunca consola: los registros de Vercel no pueden llevar códigos de ingreso.
 * 4. Local y desarrollo: consola.
 */
export function crearEnviadorDelCanal(canal: CanalDeCorreo, source: Entorno): EnviadorDeCorreo {
  if (source.NODE_ENV === "test") return enviadorEnMemoriaDelCanal(canal);
  const configuracion = configuracionDelCanal(canal, source);
  if (configuracion) return crearEnviadorResend(configuracion);
  if (source.VERCEL) return crearEnviadorSinConfigurar(canal);
  return crearEnviadorDeConsola(canal);
}

const MAXIMO_DE_DESTINATARIOS = 50;
const MAXIMO_DEL_TEXTO = 100_000;
const UNA_LINEA = /^[^\r\n]+$/;

/** Lo que el proveedor rechazaría igual, cortado acá: devuelve el problema, o `null` si el mensaje está bien. */
function problemaDelMensaje(m: MensajeDeCorreo): string | null {
  if (m.para.length === 0 || m.para.length > MAXIMO_DE_DESTINATARIOS) return `entre 1 y ${MAXIMO_DE_DESTINATARIOS} destinatarios`;
  if (!m.para.every(esDireccionValida)) return "destinatario inválido";
  if (m.responderA !== undefined && !esDireccionValida(m.responderA)) return "dirección de respuesta inválida";
  if (!UNA_LINEA.test(m.asunto) || m.asunto.length > 200) return "asunto vacío, de más de 200 caracteres o con saltos de línea";
  if (m.texto.trim() === "" || m.texto.length > MAXIMO_DEL_TEXTO) return "texto vacío o demasiado largo";
  if (m.claveDeIdempotencia !== undefined && (!UNA_LINEA.test(m.claveDeIdempotencia) || m.claveDeIdempotencia.length > 256)) return "clave de idempotencia inválida";
  return null;
}

/**
 * Manda un mail por el canal CON el enviador que se le pasa (Pureza 1.4: el dominio no lee `process.env`; el enviador del proceso, armado con el entorno,
 * lo arma `src/lib/enviar-correo.ts`). NO lanza: un fallo vuelve como `{ ok: false, motivo, detalle }` y también se reporta a Sentry (una vez por
 * arranque y causa; el detalle no lleva contenido del mail ni destinatarios).
 *
 * Llamar SIEMPRE después del commit, nunca dentro de una transacción: una transacción serializable se reintenta entera y volvería a mandar el mail.
 * Canal de avisos: si falla, la acción ya quedó hecha y se reenvía a mano (sin cola). Canal operativo: quien llama decide el reintento según `motivo`.
 */
export async function enviarConEnviador(canal: CanalDeCorreo, enviador: EnviadorDeCorreo, mensaje: MensajeDeCorreo): Promise<ResultadoDeEnvio> {
  const problema = problemaDelMensaje(mensaje);
  const resultado: ResultadoDeEnvio = problema ? { ok: false, motivo: "DEFINITIVO", detalle: `mensaje inválido: ${problema}` } : await enviador.enviar(mensaje);
  if (!resultado.ok) await reportarErrorUnaVez(`correo:${canal}:${resultado.motivo}:${resultado.detalle}`, new Error(`Correo ${canal} no enviado (${resultado.motivo}): ${resultado.detalle}`), "correo");
  return resultado;
}
