import { sincronizarIPC } from "@/core/reportes/indices-economicos";
import { baseDelContexto } from "@/core/auth/base";
import { autorizacionCronValida } from "@/core/auth/secreto-cron";
import { reportarError, reportarErrorUnaVez } from "@/lib/reportar-error";

/**
 * Vercel Cron (ver vercel.json, "0 12 * * *" — TODOS los días: el INDEC publica el
 * IPC a mitad de mes en una fecha variable y la carga es segura de repetir, porque
 * nunca reescribe un mes ya guardado) — nunca se llama a mano desde la UI. Auth vía CRON_SECRET: Vercel firma cada invocación de
 * Cron con este mismo header (https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs),
 * así que un request sin el secreto correcto (o llamado desde afuera) se
 * rechaza antes de tocar la DB.
 */
export async function GET(request: Request): Promise<Response> {
  const auth = request.headers.get("authorization");
  // Un proyecto sin CRON_SECRET hace que el cron responda 401 SIEMPRE y en silencio: eso es un error de configuración y se avisa.
  if (!process.env.CRON_SECRET) await reportarErrorUnaVez("ipc-cron-sin-secreto", new Error("CRON_SECRET no está configurada: el cron del IPC no puede autenticarse"), "ipc-cron");
  if (!autorizacionCronValida(auth, process.env.CRON_SECRET)) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const resultado = await sincronizarIPC(baseDelContexto().db);
    // Un cron que responde 200 con `mesesNuevos: 0` todos los días durante meses es indistinguible de uno sano: si la serie GUARDADA quedó más
    // vieja que el máximo previsto (5c), es un incidente y se avisa (una sola vez por instancia, ver reportarErrorUnaVez). La respuesta sigue
    // siendo 200: la corrida hizo lo que pudo. La decisión de reportar vive acá y no en el core, que queda sin efectos.
    const { antiguedad } = resultado;
    if (antiguedad.estado === "vencida") {
      await reportarErrorUnaVez(
        "ipc-serie-vencida",
        new Error(`La serie del IPC guardada no se actualiza desde ${antiguedad.ultimoMes} (${antiguedad.diasDeAtraso} días; el máximo previsto es ${antiguedad.maximo}): el cron no está trayendo meses nuevos.`),
        "ipc-cron"
      );
    }
    return Response.json(resultado);
  } catch (e) {
    await reportarError(e, "ipc-cron");
    return Response.json({ error: e instanceof Error ? e.message : "Error desconocido" }, { status: 502 });
  }
}
