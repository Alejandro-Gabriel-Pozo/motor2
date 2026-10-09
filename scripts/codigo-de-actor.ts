import { createInterface } from "node:readline";
import { Writable } from "node:stream";

/**
 * De dónde sale el código del actor de un script de plataforma (M-32; ver `src/server/operaciones-de-plataforma/probar-actor-de-plataforma.ts`): de la variable de entorno
 * `PLATAFORMA_CODIGO_ACTOR` o, si no está y el script corre en una terminal, de un prompt que NO repite lo que se escribe. NUNCA de un argumento de línea de comandos (quedaría en el historial
 * del intérprete y en la lista de procesos) y nunca se imprime ni se guarda. Sin ninguna de las dos vías devuelve `undefined` y el script no sigue.
 */
export const VARIABLE_DEL_CODIGO_DE_ACTOR = "PLATAFORMA_CODIGO_ACTOR";

export interface TerminalParaElCodigo {
  esInteractiva: boolean;
  /** Muestra la pregunta y devuelve lo escrito, sin repetirlo en pantalla. */
  preguntar(pregunta: string): Promise<string>;
}

/** La terminal real: stdin/stdout, con la salida enmudecida mientras se escribe. */
export const TERMINAL_REAL: TerminalParaElCodigo = {
  esInteractiva: Boolean(process.stdin.isTTY),
  preguntar(pregunta) {
    return new Promise((resolver) => {
      let enmudecida = false;
      const salida = new Writable({
        write(trozo, _codificacion, listo) {
          if (!enmudecida) process.stdout.write(trozo);
          listo();
        },
      });
      const lector = createInterface({ input: process.stdin, output: salida, terminal: true });
      lector.question(pregunta, (respuesta) => {
        lector.close();
        process.stdout.write("\n");
        resolver(respuesta);
      });
      enmudecida = true;
    });
  },
};

export async function leerCodigoDelActor(entorno: Record<string, string | undefined>, terminal: TerminalParaElCodigo = TERMINAL_REAL): Promise<string | undefined> {
  const deLaVariable = entorno[VARIABLE_DEL_CODIGO_DE_ACTOR]?.trim();
  if (deLaVariable) return deLaVariable;
  if (!terminal.esInteractiva) return undefined;
  const escrito = (await terminal.preguntar("Código de tu app de autenticación (6 dígitos): ")).trim();
  return escrito || undefined;
}
