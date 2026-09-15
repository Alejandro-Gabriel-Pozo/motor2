import * as Sentry from "@sentry/nextjs";

/**
 * Observabilidad — hallazgo de la auditoría de backend: nada capturaba ni
 * agregaba errores de producción, solo quedaban sueltos en los logs de
 * Vercel (que sí existen gratis, pero nadie los mira proactivamente).
 * Proyecto Sentry nuevo, org `zuluhub` — DSN vía env, nunca hardcodeado
 * (no es secreto, pero así conviven ambientes distintos sin tocar código).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      tracesSampleRate: 0.1,
    });
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      tracesSampleRate: 0.1,
    });
  }
}

export const onRequestError = Sentry.captureRequestError;
