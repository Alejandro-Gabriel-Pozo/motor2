/**
 * Manda un error a Sentry sin que reportarlo pueda romper nada. Los fallos que se atrapan a propósito para no tirar abajo una pantalla o un
 * cron (por ejemplo, las APIs de terceros del dólar) quedaban solo en `console.error`, y los registros de Vercel del plan Hobby duran 30
 * minutos: nadie se enteraba. `area` queda como etiqueta para filtrarlos en Sentry. Sin DSN configurado (desarrollo, pruebas) no hace nada.
 */
export async function reportarError(error: unknown, area: string): Promise<void> {
  try {
    const Sentry = await import("@sentry/nextjs");
    Sentry.captureException(error, { tags: { area } });
    // Corren fuera de una respuesta (`after`, crons): sin esperar, el proceso puede terminar antes de que el evento salga.
    await Sentry.flush(2000);
  } catch {
    // reportar es un extra: nunca debe fallar quien lo llama
  }
}

const yaReportados = new Set<string>();

/**
 * Como `reportarError`, pero UNA sola vez por `clave` en cada arranque en frío del servidor. Para condiciones que se repiten en cada
 * pedido mientras dura un estado (por ejemplo, un cron sin `CRON_SECRET` responde 401 a cada llamada, incluidas las de escáneres de
 * terceros): sin esto, un solo problema de configuración gastaría la cuota de Sentry.
 */
export async function reportarErrorUnaVez(clave: string, error: unknown, area: string): Promise<void> {
  if (yaReportados.has(clave)) return;
  yaReportados.add(clave);
  await reportarError(error, area);
}
