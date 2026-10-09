import { crearEnviadorDelCanal, enviarConEnviador } from "@/core/correo/enviar";
import { crearEnviadorResend } from "@/lib/correo/resend";
import { reportarErrorUnaVez } from "@/lib/reportar-error";
import type { CanalDeCorreo, EnviadorDeCorreo, MensajeDeCorreo, ResultadoDeEnvio } from "@/core/correo/tipos";

/**
 * El enviador de correo del PROCESO (Pureza 1.4): el adaptador que arma el enviador de cada canal con el entorno real (`process.env`) y lo recuerda. El dominio
 * (`core/correo`) no lee el entorno: elige la implementación según el entorno que se le pasa (`crearEnviadorDelCanal`) y manda con el enviador que se le da
 * (`enviarConEnviador`). Vive en `lib/` y no en `server/` porque lo usan tanto la app como la consola de plataforma, que no puede importar `server/`.
 */
let enviadoresDelProceso: Partial<Record<CanalDeCorreo, EnviadorDeCorreo>> = {};

function enviadorDelProceso(canal: CanalDeCorreo): EnviadorDeCorreo {
  return (enviadoresDelProceso[canal] ??= crearEnviadorDelCanal(canal, process.env, crearEnviadorResend));
}

/** Para los tests de la selección: olvida los enviadores ya armados con el entorno del proceso. */
export function olvidarEnviadoresDelProceso(): void {
  enviadoresDelProceso = {};
}

/**
 * Manda un mail por el canal, con el enviador que corresponde al entorno del proceso. NO lanza (ver `enviarConEnviador`).
 * Llamar SIEMPRE después del commit, nunca dentro de una transacción.
 */
export async function enviarCorreo(canal: CanalDeCorreo, mensaje: MensajeDeCorreo): Promise<ResultadoDeEnvio> {
  const resultado = await enviarConEnviador(canal, enviadorDelProceso(canal), mensaje);
  // Un fallo también se reporta a Sentry, una vez por arranque y causa (el detalle no lleva contenido del mail ni destinatarios).
  if (!resultado.ok) await reportarErrorUnaVez(`correo:${canal}:${resultado.motivo}:${resultado.detalle}`, new Error(`Correo ${canal} no enviado (${resultado.motivo}): ${resultado.detalle}`), "correo");
  return resultado;
}
