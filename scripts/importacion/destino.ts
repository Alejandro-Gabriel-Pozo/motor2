import { primerHostNoLocal } from "../../src/core/auth/hosts-de-conexion";

/**
 * GUARDAS DE DESTINO del comando del importador del catálogo (docs/diseno-importador-de-catalogo-2026-10-28.md §8): a qué base va a leer o escribir (host y nombre, nunca la clave) y si
 * puede CONFIRMAR ahí. Contra un Postgres LOCAL (todos los hosts de la conexión son `localhost`/`127.0.0.1`: el `?host=` de la URL manda sobre el de la URL, `primerHostNoLocal`) la vista
 * previa y la confirmación corren sin más. Contra cualquier otra base (producción, una rama de ensayo de Neon) la vista previa (solo lectura) corre y la CONFIRMACIÓN exige además
 * `MOTOR2_IMPORTAR_CONFIRMAR=si` en la línea de comandos de esa corrida (nunca en un archivo de entorno: no se confirma una base real por accidente). Pura: recibe el entorno.
 */
export interface DestinoDeLaImportacion {
  host: string;
  nombre: string;
  remoto: boolean;
}

const HOSTS_LOCALES = ["localhost", "127.0.0.1"];

export function destinoDeLaImportacion(env: Record<string, string | undefined>): DestinoDeLaImportacion {
  const url = env.DATABASE_URL;
  if (!url) throw new Error("Falta DATABASE_URL: no hay base a la que importar.");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("DATABASE_URL no es una URL válida.");
  }
  const nombre = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!nombre || nombre.includes("/")) throw new Error("DATABASE_URL no trae el nombre de la base.");
  const noLocal = primerHostNoLocal(parsed, HOSTS_LOCALES);
  return noLocal === null ? { host: parsed.hostname, nombre, remoto: false } : { host: noLocal, nombre, remoto: true };
}

/** Lanza si se quiere CONFIRMAR contra una base que no es local sin `MOTOR2_IMPORTAR_CONFIRMAR=si`. */
export function verificarQuePuedeConfirmar(destino: DestinoDeLaImportacion, env: Record<string, string | undefined>): void {
  if (destino.remoto && env.MOTOR2_IMPORTAR_CONFIRMAR !== "si") {
    throw new Error(
      `Confirmar contra una base que NO es local (host ${destino.host}, base "${destino.nombre}") exige MOTOR2_IMPORTAR_CONFIRMAR=si en la línea de comandos de esta corrida. No se escribió nada.`,
    );
  }
}
