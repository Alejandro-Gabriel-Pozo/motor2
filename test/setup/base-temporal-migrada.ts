import "dotenv/config";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { primerHostNoLocal } from "../../src/core/auth/hosts-de-conexion";

/**
 * Base de datos TEMPORAL armada aplicando las migraciones de `prisma/migrations` una por una, en orden, como las vería una base real que se
 * fue migrando con el tiempo. Sirve para los tests que necesitan insertar datos ENTRE dos migraciones (por ejemplo, el catálogo que sembró
 * `prisma/seed.ts` antes de que existieran las migraciones de datos) y mirar el resultado de aplicar todas.
 *
 * Seguridad: usa el dueño (`DIRECT_URL`) solo para crear y borrar bases con su propio prefijo `<base>_paridad_<pid>`; se niega a correr si el
 * servidor no es local. Nunca toca la base de desarrollo, la de e2e ni una real.
 */

const RAIZ_MIGRACIONES = join(__dirname, "../../prisma/migrations");
const SERVIDORES_LOCALES = ["localhost", "127.0.0.1", "::1", "[::1]"];

function direccionDelDuenio(): URL {
  const direccion = process.env.DIRECT_URL;
  if (!direccion) throw new Error("base-temporal-migrada: falta DIRECT_URL (el dueño de las tablas).");
  const url = new URL(direccion);
  // M-29: también los hosts de `?host=`/`hostaddr=`, que mandan sobre el de la URL.
  const noLocal = primerHostNoLocal(url, SERVIDORES_LOCALES);
  if (noLocal !== null) {
    throw new Error(`base-temporal-migrada: me niego a crear bases en "${noLocal}"; solo corre contra un Postgres local.`);
  }
  return url;
}

const nombresDeMigraciones = () =>
  readdirSync(RAIZ_MIGRACIONES, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

const prefijoDeLaBase = (url: URL) => `${url.pathname.replace(/^\//, "")}_paridad_`;

function procesoVivo(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export interface BaseTemporalMigrada {
  /** La URL (del dueño) de la base temporal: para armar un cliente de Prisma contra ella. */
  url: string;
  /** Cliente (como dueño) de la base temporal. */
  cliente: Client;
  /** Aplica, en orden, las migraciones pendientes ANTERIORES a `migracion` (ella no). */
  aplicarAntesDe(migracion: string): Promise<void>;
  /** Aplica todas las migraciones que falten. */
  aplicarRestantes(): Promise<void>;
  /** Cierra la conexión y borra la base. */
  eliminar(): Promise<void>;
}

export async function crearBaseTemporalMigrada(): Promise<BaseTemporalMigrada> {
  const duenio = direccionDelDuenio();
  const prefijo = prefijoDeLaBase(duenio);
  const nombre = `${prefijo}${process.pid}`;

  const admin = new Client({ connectionString: duenio.toString() });
  await admin.connect();
  try {
    // Restos de una corrida que murió sin limpiar: solo bases con NUESTRO prefijo y cuyo proceso ya no existe.
    const previas = await admin.query<{ datname: string }>("SELECT datname FROM pg_database WHERE datname LIKE $1", [`${prefijo}%`]);
    for (const { datname } of previas.rows) {
      const pid = Number(datname.slice(prefijo.length));
      if (/^\d+$/.test(datname.slice(prefijo.length)) && !procesoVivo(pid)) await admin.query(`DROP DATABASE IF EXISTS "${datname}" WITH (FORCE)`);
    }
    await admin.query(`CREATE DATABASE "${nombre}"`);
  } finally {
    await admin.end();
  }

  const urlTemporal = new URL(duenio.toString());
  urlTemporal.pathname = `/${nombre}`;
  const cliente = new Client({ connectionString: urlTemporal.toString() });
  await cliente.connect();

  const pendientes = nombresDeMigraciones();
  const aplicar = async (nombreMigracion: string) => {
    const sql = readFileSync(join(RAIZ_MIGRACIONES, nombreMigracion, "migration.sql"), "utf8");
    try {
      await cliente.query(sql);
    } catch (e) {
      throw new Error(`base-temporal-migrada: falló la migración ${nombreMigracion}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return {
    url: urlTemporal.toString(),
    cliente,
    async aplicarAntesDe(migracion) {
      if (!pendientes.includes(migracion)) throw new Error(`base-temporal-migrada: la migración "${migracion}" no existe (o ya se aplicó).`);
      while (pendientes[0] !== migracion) await aplicar(pendientes.shift() as string);
    },
    async aplicarRestantes() {
      while (pendientes.length > 0) await aplicar(pendientes.shift() as string);
    },
    async eliminar() {
      await cliente.end().catch(() => undefined);
      const limpieza = new Client({ connectionString: duenio.toString() });
      await limpieza.connect();
      try {
        await limpieza.query(`DROP DATABASE IF EXISTS "${nombre}" WITH (FORCE)`);
      } finally {
        await limpieza.end();
      }
    },
  };
}
