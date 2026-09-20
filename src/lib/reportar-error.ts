/**
 * Manda un error a Sentry sin que reportarlo pueda romper nada. Los fallos que se atrapan a propósito para no tirar abajo una pantalla o un
 * cron (por ejemplo, las APIs de terceros del dólar) quedaban solo en `console.error`, y los registros de Vercel del plan Hobby duran 30
 * minutos: nadie se enteraba. `area` queda como etiqueta para filtrarlos en Sentry. Sin DSN configurado (desarrollo, pruebas) no hace nada.
 */
export async function reportarError(error: unknown, area: string): Promise<void> {
  try {
    const Sentry = await import("@sentry/nextjs");
    Sentry.captureException(error, { tags: { area } });
  } catch {
    // reportar es un extra: nunca debe fallar quien lo llama
  }
}
