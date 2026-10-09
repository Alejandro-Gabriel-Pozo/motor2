/**
 * Manda un error a Sentry sin que reportarlo pueda romper nada. Los fallos que se atrapan a propósito para no tirar abajo una pantalla o un
 * cron (por ejemplo, las APIs de terceros del dólar) quedaban solo en `console.error`, y los registros de Vercel del plan Hobby duran 30
 * minutos: nadie se enteraba. `area` queda como etiqueta para filtrarlos en Sentry.
 *
 * Sin DSN configurado (desarrollo, pruebas, un despliegue sin Sentry) Sentry no manda nada y el fallo quedaba SIN RASTRO (M-27 de la auditoría intermedia: un cron respondía 502 genérico y
 * ningún registro decía qué área ni qué tipo de error). Ahora, sin DSN, deja una línea de `console.error` con un RESUMEN: el área y el tipo del error (y el código si es de la base), nunca el
 * mensaje crudo, que puede traer ids, hosts, cadenas de conexión o datos de negocio.
 */
export async function reportarError(error: unknown, area: string): Promise<void> {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) console.error(resumenDeErrorParaElLog(error, area));
  try {
    const Sentry = await import("@sentry/nextjs");
    Sentry.captureException(error, { tags: { area } });
    // Corren fuera de una respuesta (`after`, crons): sin esperar, el proceso puede terminar antes de que el evento salga.
    await Sentry.flush(2000);
  } catch {
    // reportar es un extra: nunca debe fallar quien lo llama
  }
}

/**
 * La línea de log de un error sin Sentry: `[error] area=<área> tipo=<nombre de la clase>` y, si es un error de Prisma con código (`P2002`, `P2034`…), ` codigo=<código>`. NUNCA el `message` ni la
 * pila (traen valores). El nombre y el área se acotan a caracteres de identificador: un error con un `name` inventado no puede colar texto libre en el registro.
 */
export function resumenDeErrorParaElLog(error: unknown, area: string): string {
  const nombre = error instanceof Error ? error.name : typeof error;
  const codigo = typeof (error as { code?: unknown } | null)?.code === "string" ? (error as { code: string }).code : "";
  const seguro = (t: string) => t.replace(/[^\w.-]/g, "_").slice(0, 60);
  return `[error] area=${seguro(area)} tipo=${seguro(nombre)}${/^P\d{4}$/.test(codigo) ? ` codigo=${codigo}` : ""}`;
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
