import type { EnviadorDeCorreo, MensajeDeCorreo, MotivoDeFalloDeCorreo, ResultadoDeEnvio } from "@/core/correo/tipos";

/**
 * El cliente HTTP de Resend: el ADAPTADOR de red del correo (Pureza Fase 4, auditoría de la Fase 1). Vivía en `core/correo/` con `fetchFn = fetch` como valor por defecto —red dentro del
 * núcleo que el analizador no veía porque solo detectaba llamadas—; ahora vive en `lib/` (lo usan la app y la consola) y el núcleo lo recibe inyectado (`crearEnviadorDelCanal`).
 */

const URL_DE_ENVIO = "https://api.resend.com/emails";
const TIEMPO_MAXIMO_MS = 15_000;

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** El cuerpo como JSON; un cuerpo que no lo es (página de error de un proxy) no cambia lo que se hace: se decide por el estado. */
async function cuerpoJson(respuesta: Response): Promise<unknown> {
  try {
    return await respuesta.json();
  } catch {
    return null;
  }
}

/** Del cuerpo de error de Resend se toma solo `name` (código estable): `message` puede repetir destinatarios u otros datos. */
function nombreDelError(cuerpo: unknown): string {
  const nombre = (cuerpo as { name?: unknown } | null)?.name;
  return typeof nombre === "string" && /^[a-z0-9_]{1,60}$/.test(nombre) ? nombre : "sin_nombre";
}

/**
 * Cómo se trata cada respuesta de error de Resend (documentación de errores de su API):
 * - 429 `daily_quota_exceeded` / `monthly_quota_exceeded`: cupo de la cuenta → `CUPO`. Otro 429 (`rate_limit_exceeded`, por segundo) → `TRANSITORIO`.
 * - 409 `concurrent_idempotent_requests`: el mismo mail está en vuelo → `TRANSITORIO`. Otro 409 (`invalid_idempotent_request`: misma clave, otro contenido) → `DEFINITIVO`.
 * - 408 y 5xx: falla del proveedor → `TRANSITORIO`.
 * - El resto (400, 401, 403, 422: clave inválida, dominio sin verificar, destinatario inválido) → `DEFINITIVO`.
 */
export function motivoDeFalloDeResend(status: number, nombre: string): MotivoDeFalloDeCorreo {
  if (status === 429) return /quota/.test(nombre) ? "CUPO" : "TRANSITORIO";
  if (status === 409) return nombre === "concurrent_idempotent_requests" ? "TRANSITORIO" : "DEFINITIVO";
  if (status === 408 || status >= 500) return "TRANSITORIO";
  return "DEFINITIVO";
}

export function crearEnviadorResend(config: { claveResend: string; remitente: string }, fetchFn: Fetch = fetch): EnviadorDeCorreo {
  return {
    implementacion: "resend",
    async enviar(mensaje: MensajeDeCorreo): Promise<ResultadoDeEnvio> {
      const cabeceras: Record<string, string> = { Authorization: `Bearer ${config.claveResend}`, "Content-Type": "application/json" };
      if (mensaje.claveDeIdempotencia) cabeceras["Idempotency-Key"] = mensaje.claveDeIdempotencia;
      const cuerpo = {
        from: config.remitente,
        to: [...mensaje.para],
        subject: mensaje.asunto,
        text: mensaje.texto,
        ...(mensaje.html ? { html: mensaje.html } : {}),
        ...(mensaje.responderA ? { reply_to: mensaje.responderA } : {}),
      };
      let respuesta: Response;
      try {
        respuesta = await fetchFn(URL_DE_ENVIO, { method: "POST", headers: cabeceras, body: JSON.stringify(cuerpo), cache: "no-store", signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS) });
      } catch {
        return { ok: false, motivo: "TRANSITORIO", detalle: "Resend: sin respuesta (red o tiempo agotado)" };
      }
      const json = await cuerpoJson(respuesta);
      if (respuesta.ok) {
        const id = (json as { id?: unknown } | null)?.id;
        return { ok: true, idExterno: typeof id === "string" ? id : null };
      }
      const nombre = nombreDelError(json);
      return { ok: false, motivo: motivoDeFalloDeResend(respuesta.status, nombre), detalle: `Resend ${respuesta.status} ${nombre}` };
    },
  };
}
