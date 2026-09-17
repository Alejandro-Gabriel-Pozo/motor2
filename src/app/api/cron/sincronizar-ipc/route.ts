import { sincronizarIPC } from "@/core/reportes/indices-economicos";

/**
 * Vercel Cron (ver vercel.json, "0 12 15 * *" — día 15 de cada mes, cuando
 * el INDEC ya suele haber publicado el mes anterior) — nunca se llama a
 * mano desde la UI. Auth vía CRON_SECRET: Vercel firma cada invocación de
 * Cron con este mismo header (https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs),
 * así que un request sin el secreto correcto (o llamado desde afuera) se
 * rechaza antes de tocar la DB.
 */
export async function GET(request: Request): Promise<Response> {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const resultado = await sincronizarIPC();
    return Response.json(resultado);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Error desconocido" }, { status: 502 });
  }
}
