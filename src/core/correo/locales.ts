import type { CanalDeCorreo, EnviadorDeCorreo, MensajeDeCorreo, MotivoDeFalloDeCorreo, ResultadoDeEnvio } from "./tipos";

/**
 * Consola: para local y desarrollo. Muestra el mail en la terminal del servidor y NO lo envía. Es la ÚNICA implementación que escribe el
 * contenido de un mail (puede traer el código de ingreso: sin esto nadie podría entrar en local sin una clave de Resend), y por eso
 * `crearEnviadorDelCanal` nunca la elige dentro de Vercel.
 */
export function crearEnviadorDeConsola(canal: CanalDeCorreo, escribir: (linea: string) => void = (linea) => console.info(linea)): EnviadorDeCorreo {
  return {
    implementacion: "consola",
    async enviar(mensaje: MensajeDeCorreo): Promise<ResultadoDeEnvio> {
      escribir(
        [
          `──── correo (${canal}) — NO se envía, solo se muestra ────`,
          `Para: ${mensaje.para.join(", ")}`,
          ...(mensaje.responderA ? [`Responder a: ${mensaje.responderA}`] : []),
          `Asunto: ${mensaje.asunto}`,
          "",
          mensaje.texto,
          "────────────────────────────────────────────────────────",
        ].join("\n"),
      );
      return { ok: true, idExterno: null };
    },
  };
}

export interface EnviadorEnMemoria extends EnviadorDeCorreo {
  readonly enviados: MensajeDeCorreo[];
  /** El próximo `enviar` falla con este motivo (y no queda en `enviados`); los siguientes vuelven a andar. */
  fallarProximoEnvio(motivo: MotivoDeFalloDeCorreo): void;
  vaciar(): void;
}

/** Memoria: para los tests. Guarda los mails en `enviados` en vez de mandarlos. */
export function crearEnviadorEnMemoria(): EnviadorEnMemoria {
  let falloPendiente: MotivoDeFalloDeCorreo | null = null;
  const enviados: MensajeDeCorreo[] = [];
  return {
    implementacion: "memoria",
    enviados,
    async enviar(mensaje) {
      if (falloPendiente) {
        const motivo = falloPendiente;
        falloPendiente = null;
        return { ok: false, motivo, detalle: `memoria: fallo simulado (${motivo})` };
      }
      enviados.push(mensaje);
      return { ok: true, idExterno: `memoria-${enviados.length}` };
    },
    fallarProximoEnvio(motivo) {
      falloPendiente = motivo;
    },
    vaciar() {
      enviados.length = 0;
      falloPendiente = null;
    },
  };
}

/** El canal no tiene clave y remitente (y no es local): no envía nada y lo dice, en vez de simular que mandó. */
export function crearEnviadorSinConfigurar(canal: CanalDeCorreo): EnviadorDeCorreo {
  return {
    implementacion: "sin-configurar",
    async enviar(): Promise<ResultadoDeEnvio> {
      return { ok: false, motivo: "DEFINITIVO", detalle: `canal ${canal} sin configurar` };
    },
  };
}
