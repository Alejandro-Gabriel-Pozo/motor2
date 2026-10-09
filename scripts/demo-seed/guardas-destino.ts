/**
 * Guardas de destino del ejecutor del seed de 6 meses (docs/planes-demo-y-claridad-reportes-2026-09-21.md §5, "Diseño
 * recomendado": "Guardas de destino obligatorias, en este orden, antes de conectarse: host local, nombre de base con sufijo
 * permitido, verificación de `current_database()`, rechazo si ya hay datos salvo bandera explícita de 'rehacer', y una
 * confirmación explícita por variable de entorno antes de escribir").
 *
 * Mismo mecanismo que `test/e2e/fixtures/base-e2e.ts` (sufijo "_e2e") y `scripts/benchmark-reportes.ts`
 * (`requerirUrlDeBenchmark`), con su propia variable de entorno y su propio sufijo ("_demo") — el seed de 6 meses escribe
 * MUCHOS más datos que un reset de E2E o que el benchmark, así que tiene su carril propio, nunca comparte base con ninguno
 * de los otros dos.
 *
 * `resolverUrlDelSeed` es pura (recibe el entorno como parámetro, LANZA en vez de `process.exit`) para poder testearla sin
 * conectarse a nada — mismo criterio que `resolverUrlE2E`. Las guardas que sí necesitan una conexión real
 * (`current_database()`, "¿ya hay datos?") viven en `verificarBaseDelSeed`, que se llama DESPUÉS.
 *
 * S-33: el seed BASE (`prisma/seed.ts`, que escribe en la `DATABASE_URL` del `.env`) usa las mismas piezas —host local, sin proveedor gestionado, nunca en producción/Vercel— en
 * `resolverDestinoDelSeedBase`, con UNA vía explícita para una base real (`--permitir-remoto` más una confirmación interactiva, `confirmarDestinoRemoto`): sembrar la base real es
 * legítimo (el primer gerente, las acciones nuevas), pero no por accidente.
 */

type Entorno = Record<string, string | undefined>;

const HOSTS_PERMITIDOS = ["localhost", "127.0.0.1"];
const PROHIBIDOS = ["neon.tech", "vercel", "supabase", "amazonaws", "pooler"];
const SUFIJO_OBLIGATORIO = "_demo";

export interface BaseDelSeed {
  url: string;
  host: string;
  nombre: string;
}

/** Ningún seed corre en producción ni dentro de Vercel: `que` dice cuál (para el mensaje). */
function verificarEntornoNoProductivo(env: Entorno, que: string): void {
  if (env.NODE_ENV === "production" || env.VERCEL || env.VERCEL_ENV) {
    throw new Error(`El ${que} no corre en un entorno de producción/Vercel (NODE_ENV=production o VERCEL definidas).`);
  }
}

function leerUrlDeConexion(url: string, variable: string): URL {
  try {
    return new URL(url);
  } catch {
    throw new Error(`${variable} no es una URL válida.`);
  }
}

const esHostLocal = (host: string) => HOSTS_PERMITIDOS.includes(host);
const pareceProveedorGestionado = (url: string) => PROHIBIDOS.some((p) => url.includes(p));
const nombreDeLaBase = (parsed: URL) => decodeURIComponent(parsed.pathname.replace(/^\//, ""));

/** Valida `MOTOR2_SEED_DATABASE_URL` ANTES de conectarse a nada. NO hay fallback a `DATABASE_URL`: sembrar 6 meses de datos por accidente sobre la base de desarrollo (o peor) es justo lo que esto existe para impedir. */
export function resolverUrlDelSeed(env: Entorno): BaseDelSeed {
  const url = env.MOTOR2_SEED_DATABASE_URL;
  if (!url) {
    throw new Error(
      'Falta MOTOR2_SEED_DATABASE_URL (ver .env.example). El seed de 6 meses corre contra una base local dedicada cuyo nombre termina en "_demo"; no hay fallback a DATABASE_URL a propósito.'
    );
  }
  verificarEntornoNoProductivo(env, "seed de 6 meses");
  const parsed = leerUrlDeConexion(url, "MOTOR2_SEED_DATABASE_URL");
  const host = parsed.hostname;
  if (!esHostLocal(host)) {
    throw new Error(`Host rechazado (${host}): el seed de 6 meses solo corre contra un Postgres LOCAL (localhost o 127.0.0.1) — nunca contra Neon.`);
  }
  if (pareceProveedorGestionado(url)) {
    throw new Error("MOTOR2_SEED_DATABASE_URL parece apuntar a un proveedor gestionado — rechazada.");
  }
  const nombre = nombreDeLaBase(parsed);
  if (!nombre || nombre.includes("/") || !nombre.endsWith(SUFIJO_OBLIGATORIO)) {
    throw new Error(`El nombre de la base ("${nombre}") tiene que terminar en "${SUFIJO_OBLIGATORIO}".`);
  }
  return { url, host, nombre };
}

/** Confirmación explícita, aparte de la URL — evita que un `.env` con la variable ya cargada dispare una corrida sin que nadie la haya pedido a propósito HOY. */
export function verificarConfirmacionExplicita(env: Entorno): void {
  if (env.MOTOR2_SEED_CONFIRMAR !== "si") {
    throw new Error('Falta confirmación explícita: MOTOR2_SEED_CONFIRMAR="si" (no viene de .env por defecto, se pasa en la línea de comandos de la corrida).');
  }
}

/** `MOTOR2_SEED_REHACER=si` — permite sembrar aunque la sucursal de la demo ya exista (si no, `verificarBaseVacia` aborta). */
export function pideRehacer(env: Entorno): boolean {
  return env.MOTOR2_SEED_REHACER === "si";
}

/**
 * Guardas que SÍ necesitan la conexión real: qué base es de verdad (`current_database()`, por si un pooler la cambia en el
 * camino) y si ya hay datos de una corrida anterior. `sucursalYaExiste` lo evalúa quien llama (ya tiene el cliente Prisma
 * abierto) — acá solo se decide qué hacer con esa respuesta, para que la política quede en un solo lugar y sea testeable
 * sin base real.
 */
export function verificarBaseVacia(nombreSucursal: string, sucursalYaExiste: boolean, rehacer: boolean): void {
  if (sucursalYaExiste && !rehacer) {
    throw new Error(`Ya existe la sucursal "${nombreSucursal}" — si es a propósito, volvé a correr con MOTOR2_SEED_REHACER=si.`);
  }
}

// ---- El seed BASE (`prisma/seed.ts`, S-33) ----

/** A qué base va a escribir el seed base: `remoto` si NO es un Postgres local (solo con `--permitir-remoto`). Nunca lleva credenciales. */
export interface DestinoDelSeedBase {
  host: string;
  nombre: string;
  remoto: boolean;
}

/**
 * Valida `DATABASE_URL` (la que usa `prisma/seed.ts` vía `src/lib/db`) ANTES de conectarse a nada. Siempre rechaza producción/Vercel. Un Postgres local (`localhost`, `127.0.0.1`) se acepta;
 * cualquier otro host (Neon, un pooler, un host cualquiera) se rechaza con un mensaje claro, salvo con `permitirRemoto` (el flag `--permitir-remoto`), que lo deja pasar marcado como
 * `remoto` para que quien llama pida la confirmación interactiva. Un host local con un proveedor gestionado escondido en la URL (`?host=…`) se rechaza siempre: lo que se confirmaría no
 * sería lo que se escribe. Los mensajes nombran host y base, nunca la URL (lleva la clave).
 */
export function resolverDestinoDelSeedBase(env: Entorno, opciones: { permitirRemoto: boolean }): DestinoDelSeedBase {
  const url = env.DATABASE_URL;
  if (!url) throw new Error("Falta DATABASE_URL: no hay base a la que sembrar.");
  verificarEntornoNoProductivo(env, "seed base");
  const parsed = leerUrlDeConexion(url, "DATABASE_URL");
  const host = parsed.hostname;
  const nombre = nombreDeLaBase(parsed);
  if (!nombre || nombre.includes("/")) throw new Error("DATABASE_URL no trae el nombre de la base: no se siembra a ciegas.");

  if (esHostLocal(host)) {
    if (pareceProveedorGestionado(url)) throw new Error("DATABASE_URL tiene un host local pero parece apuntar a un proveedor gestionado — rechazada.");
    return { host, nombre, remoto: false };
  }
  if (!opciones.permitirRemoto) {
    throw new Error(
      `Destino rechazado (${host}, base "${nombre}"): el seed base solo corre contra un Postgres LOCAL (localhost o 127.0.0.1). Si es a propósito sembrar una base real (por ejemplo, el primer gerente), volvé a correr con --permitir-remoto: te va a pedir confirmar el host y la base.`,
    );
  }
  return { host, nombre, remoto: true };
}

/**
 * La confirmación interactiva para una base REMOTA: muestra el host y el nombre de la base (sin credenciales) y exige escribir el nombre de la base. En una terminal que no es
 * interactiva (CI, una redirección) no hay nadie que confirme: se rechaza. Una base local no pide nada. `preguntar` se inyecta (en el seed, `readline`) para poder probarla.
 */
export async function confirmarDestinoRemoto(destino: DestinoDelSeedBase, preguntar: (texto: string) => Promise<string>, esInteractivo: boolean): Promise<void> {
  if (!destino.remoto) return;
  if (!esInteractivo) {
    throw new Error("Sembrar una base remota pide una confirmación interactiva (escribir el nombre de la base) y esta terminal no es interactiva (CI o una redirección): corré el comando a mano en una terminal.");
  }
  const respuesta = await preguntar(`Vas a sembrar una base REMOTA: host ${destino.host}, base "${destino.nombre}". Para confirmar, escribí el nombre de la base: `);
  if (respuesta.trim() !== destino.nombre) throw new Error("Lo escrito no es el nombre de la base: no se sembró nada.");
}
