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
 */

const HOSTS_PERMITIDOS = ["localhost", "127.0.0.1"];
const PROHIBIDOS = ["neon.tech", "vercel", "supabase", "amazonaws", "pooler"];
const SUFIJO_OBLIGATORIO = "_demo";

export interface BaseDelSeed {
  url: string;
  host: string;
  nombre: string;
}

/** Valida `MOTOR2_SEED_DATABASE_URL` ANTES de conectarse a nada. NO hay fallback a `DATABASE_URL`: sembrar 6 meses de datos por accidente sobre la base de desarrollo (o peor) es justo lo que esto existe para impedir. */
export function resolverUrlDelSeed(env: Record<string, string | undefined>): BaseDelSeed {
  const url = env.MOTOR2_SEED_DATABASE_URL;
  if (!url) {
    throw new Error(
      'Falta MOTOR2_SEED_DATABASE_URL (ver .env.example). El seed de 6 meses corre contra una base local dedicada cuyo nombre termina en "_demo"; no hay fallback a DATABASE_URL a propósito.'
    );
  }
  if (env.NODE_ENV === "production" || env.VERCEL || env.VERCEL_ENV) {
    throw new Error("El seed de 6 meses no corre en un entorno de producción/Vercel (NODE_ENV=production o VERCEL definidas).");
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("MOTOR2_SEED_DATABASE_URL no es una URL válida.");
  }
  const host = parsed.hostname;
  if (!HOSTS_PERMITIDOS.includes(host)) {
    throw new Error(`Host rechazado (${host}): el seed de 6 meses solo corre contra un Postgres LOCAL (localhost o 127.0.0.1) — nunca contra Neon.`);
  }
  if (PROHIBIDOS.some((p) => url.includes(p))) {
    throw new Error("MOTOR2_SEED_DATABASE_URL parece apuntar a un proveedor gestionado — rechazada.");
  }
  const nombre = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!nombre || nombre.includes("/") || !nombre.endsWith(SUFIJO_OBLIGATORIO)) {
    throw new Error(`El nombre de la base ("${nombre}") tiene que terminar en "${SUFIJO_OBLIGATORIO}".`);
  }
  return { url, host, nombre };
}

/** Confirmación explícita, aparte de la URL — evita que un `.env` con la variable ya cargada dispare una corrida sin que nadie la haya pedido a propósito HOY. */
export function verificarConfirmacionExplicita(env: Record<string, string | undefined>): void {
  if (env.MOTOR2_SEED_CONFIRMAR !== "si") {
    throw new Error('Falta confirmación explícita: MOTOR2_SEED_CONFIRMAR="si" (no viene de .env por defecto, se pasa en la línea de comandos de la corrida).');
  }
}

/** `MOTOR2_SEED_REHACER=si` — permite sembrar aunque la sucursal de la demo ya exista (si no, `verificarBaseVacia` aborta). */
export function pideRehacer(env: Record<string, string | undefined>): boolean {
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
