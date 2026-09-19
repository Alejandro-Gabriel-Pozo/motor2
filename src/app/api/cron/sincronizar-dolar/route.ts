import { sincronizarDolar } from "@/core/reportes/cotizacion-dolar";

/**
 * Vercel Cron (ver vercel.json): una vez por día, después del cierre del mercado. Trae el dólar oficial (BNA) de hoy y, si faltan
 * días, rellena el historial. Nunca se llama a mano desde la UI. Auth vía CRON_SECRET, igual que `sincronizar-ipc`: un pedido sin
 * el secreto correcto se rechaza antes de tocar la base.
 */
export async function GET(request: Request): Promise<Response> {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    return Response.json(await sincronizarDolar());
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Error desconocido" }, { status: 502 });
  }
}
