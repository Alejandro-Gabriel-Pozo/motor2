import { sincronizarDolar } from "@/core/reportes/cotizacion-dolar";
import { reportarError } from "@/lib/reportar-error";

/**
 * Vercel Cron (ver vercel.json): una vez por día, después del cierre del mercado. Trae el dólar oficial (BNA) de hoy y, si faltan
 * días, rellena el historial. Nunca se llama a mano desde la UI. Auth vía CRON_SECRET, igual que `sincronizar-ipc`: un pedido sin
 * el secreto correcto se rechaza antes de tocar la base.
 */
export async function GET(request: Request): Promise<Response> {
  const auth = request.headers.get("authorization");
  // Un proyecto sin CRON_SECRET hace que el cron responda 401 SIEMPRE y en silencio: eso es un error de configuración y se avisa.
  if (!process.env.CRON_SECRET) await reportarError(new Error("CRON_SECRET no está configurada: el cron del dólar no puede autenticarse"), "dolar-cron");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const resultado = await sincronizarDolar();
    // Una fuente que falló (aunque otra haya respondido) queda registrada: hoy solo se veía en la respuesta del cron.
    if (resultado.errores.length) await reportarError(new Error(`Sincronización del dólar con errores: ${resultado.errores.join("; ")}`), "dolar-cron");
    return Response.json(resultado);
  } catch (e) {
    await reportarError(e, "dolar-cron");
    return Response.json({ error: e instanceof Error ? e.message : "Error desconocido" }, { status: 502 });
  }
}
