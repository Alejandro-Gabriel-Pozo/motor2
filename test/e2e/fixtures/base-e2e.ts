import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Base de datos DEDICADA a los E2E de Playwright, con reset total.
 *
 * INVARIANTE (leer antes de tocar nada): este módulo solo puede borrar una
 * base LOCAL cuyo nombre termina en "_e2e". Contra cualquier otra cosa
 * (Neon, producción, `motor2_dev`, un host remoto) aborta SIN conectarse.
 *
 * Por qué existe: los specs de Playwright corrían contra la misma base que el
 * desarrollo (`motor2_dev`) y nada limpiaba lo que creaban — cada corrida
 * dejaba productos, operaciones, conteos, sesiones y sucursales para siempre
 * (una sola corrida sobre una base vacía dejó 67 `Operacion`, 58
 * `ConteoFisico` y 73 `Producto`). Además, hay specs cuya CORRECCIÓN dependía
 * de ese estado sucio (p. ej. "con una sola sucursal explica que no hay nada
 * que consolidar" solo pasaba por casualidad).
 *
 * Las guardas replican las de scripts/benchmark-reportes.ts
 * (`requerirUrlDeBenchmark`), con dos diferencias a propósito:
 *  - `resolverUrlE2E` LANZA en vez de llamar a `process.exit`, así se puede
 *    testear (test/arquitectura/base-e2e-guard.test.ts).
 *  - NO compara contra `DATABASE_URL`: `playwright.config.ts` la sobrescribe
 *    con la URL E2E para que la app y los workers usen la misma base, así que
 *    esa comparación rechazaría a la propia configuración. No hace falta: el
 *    sufijo "_e2e" y el host local ya impiden apuntar a `motor2_dev` o a una
 *    base real.
 */

const HOSTS_PERMITIDOS = ["localhost", "127.0.0.1"];
const PROHIBIDOS = ["neon.tech", "vercel", "supabase", "amazonaws", "pooler"];
const SUFIJO_OBLIGATORIO = "_e2e";

export interface BaseE2E {
  url: string;
  host: string;
  nombre: string;
}

/**
 * Valida `MOTOR2_E2E_DATABASE_URL` ANTES de conectarse a nada. Recibe el
 * entorno como parámetro (no lee `process.env` adentro) para poder probarla.
 * NO hay fallback a `DATABASE_URL`: un fallback silencioso a la base de
 * desarrollo es exactamente el accidente que esta guarda existe para impedir.
 */
export function resolverUrlE2E(env: Record<string, string | undefined>): BaseE2E {
  return validarUrlE2E(env, "MOTOR2_E2E_DATABASE_URL");
}

/**
 * La URL del RUNTIME de los E2E (ADR-007, A0): el rol `motor2_app` (sin superusuario, sin BYPASSRLS, no dueño) con el que
 * corren el servidor de Playwright y los specs, contra la MISMA base que `resolverUrlE2E` (el dueño, que solo resetea y migra).
 * Mismas guardas, y además tiene que apuntar al mismo host y a la misma base que el dueño. No hay fallback al dueño: correr la
 * app como dueño anularía el RLS sin aviso, que es justo lo que el rol aparte existe para impedir.
 */
export function resolverUrlAppE2E(env: Record<string, string | undefined>): BaseE2E {
  const dueno = resolverUrlE2E(env);
  const app = validarUrlE2E(env, "MOTOR2_E2E_APP_DATABASE_URL");
  if (app.host !== dueno.host || app.nombre !== dueno.nombre) {
    throw new Error(
      `MOTOR2_E2E_APP_DATABASE_URL (${app.host}/${app.nombre}) tiene que apuntar a la misma base que MOTOR2_E2E_DATABASE_URL (${dueno.host}/${dueno.nombre}).`,
    );
  }
  if (app.url === dueno.url) {
    throw new Error("MOTOR2_E2E_APP_DATABASE_URL es idéntica a MOTOR2_E2E_DATABASE_URL: el runtime tiene que usar el rol motor2_app, no el dueño.");
  }
  return app;
}

function validarUrlE2E(env: Record<string, string | undefined>, variable: string): BaseE2E {
  const url = env[variable];
  if (!url) {
    throw new Error(
      `Falta ${variable} (ver .env.example). Los E2E corren contra una base local dedicada cuyo nombre termina en "_e2e"; no hay fallback a DATABASE_URL a propósito.`,
    );
  }
  if (env.NODE_ENV === "production" || env.VERCEL || env.VERCEL_ENV) {
    throw new Error("Los E2E no corren en un entorno de producción/Vercel (NODE_ENV=production o VERCEL definidas).");
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${variable} no es una URL válida.`);
  }
  const host = parsed.hostname;
  if (!HOSTS_PERMITIDOS.includes(host)) {
    throw new Error(`Host rechazado (${host}): los E2E solo corren contra un Postgres LOCAL (localhost o 127.0.0.1).`);
  }
  if (PROHIBIDOS.some((p) => url.includes(p))) {
    throw new Error(`${variable} parece apuntar a un proveedor gestionado — rechazada.`);
  }
  const nombre = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!nombre || nombre.includes("/") || !nombre.endsWith(SUFIJO_OBLIGATORIO)) {
    throw new Error(`El nombre de la base ("${nombre}") tiene que terminar en "${SUFIJO_OBLIGATORIO}".`);
  }
  return { url, host, nombre };
}

/**
 * Cliente Prisma PROPIO para el reset — nunca el singleton de src/lib/db.ts,
 * para que sea imposible heredar por accidente una DATABASE_URL de otro lado.
 * Pide el `BaseE2E` ya validado: no se puede crear sin haber pasado la guarda.
 */
export function crearPrismaE2E(base: BaseE2E): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: base.url }) });
}

/**
 * Filas por tabla del schema `public` (salvo `_prisma_migrations`). Se lee la
 * lista de `information_schema` en vez de hardcodearla: no se desactualiza
 * cuando alguien agrega un modelo.
 */
async function contarFilasPorTabla(prisma: PrismaClient): Promise<Record<string, number>> {
  const filas = await prisma.$queryRawUnsafe<Array<{ tabla: string; n: number }>>(
    `SELECT table_name AS tabla,
            (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text::int AS n
       FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations'
      ORDER BY 1`,
  );
  return Object.fromEntries(filas.map((f) => [f.tabla, Number(f.n)]));
}

export interface ResultadoReset {
  /** Filas que había ANTES del reset (suma de todas las tablas). */
  filasAntes: number;
  /** Detalle por tabla, solo las que tenían algo. */
  detalleAntes: Record<string, number>;
}

/**
 * Vacía TODAS las tablas de la base E2E y verifica que quedaron en cero.
 *
 * Segunda barrera, independiente de la de la URL: se pregunta a la conexión
 * REAL cómo se llama la base (`current_database()`), por si la URL dice una
 * cosa y un pooler/proxy termina en otra. `TRUNCATE ... CASCADE` es
 * independiente del orden de las claves foráneas. `RegistroAuditoria` sí es
 * append-only a nivel de motor (trigger + REVOKE al rol de ejecución, migración
 * auditoria_inmutable), pero el trigger exime al dueño: este reset corre con
 * `DIRECT_URL` (dueño) y puede vaciarla, igual que `limpiarBaseDeTest`.
 */
export async function resetearBaseE2E(prisma: PrismaClient): Promise<ResultadoReset> {
  const [{ db }] = await prisma.$queryRaw<Array<{ db: string }>>`SELECT current_database() AS db`;
  if (!db.endsWith(SUFIJO_OBLIGATORIO)) {
    throw new Error(`Reset abortado: la conexión real apunta a la base "${db}", que no termina en "${SUFIJO_OBLIGATORIO}".`);
  }

  const antes = await contarFilasPorTabla(prisma);
  const detalleAntes = Object.fromEntries(Object.entries(antes).filter(([, n]) => n > 0));
  const tablas = Object.keys(antes);
  if (tablas.length === 0) throw new Error(`Reset abortado: la base "${db}" no tiene tablas (¿faltó \`prisma migrate deploy\`?).`);

  const lista = tablas.map((t) => `"${t.replace(/"/g, '""')}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${lista} RESTART IDENTITY CASCADE`);

  const despues = await contarFilasPorTabla(prisma);
  const residuo = Object.entries(despues).filter(([, n]) => n > 0);
  if (residuo.length > 0) {
    throw new Error(`Reset incompleto en "${db}": quedaron filas en ${residuo.map(([t, n]) => `${t}=${n}`).join(", ")}.`);
  }

  return { filasAntes: Object.values(detalleAntes).reduce((a, b) => a + b, 0), detalleAntes };
}
