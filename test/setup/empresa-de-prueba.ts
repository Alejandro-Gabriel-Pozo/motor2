import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * La empresa de las pruebas (ADR-022): los clientes de FIXTURES abren la conexión con `app.empresa_id` fijado como parámetro de arranque (`-c app.empresa_id=…`).
 * Así el DEFAULT de `empresaId` y el RLS ven esa empresa sin que ningún test dependa de «la única empresa ACTIVE» (el respaldo de `app_empresa_actual()` que ADR-022 retira).
 *
 * Es SOLO de `test/setup/`: el código de `src/` sigue usando el cliente sin empresa (`src/lib/db`) y corre con la semántica de producción. Nada se guarda en la base
 * (ni `ALTER ROLE … SET`): la empresa viaja en la conexión, y `test/arquitectura/sin-empresa-por-defecto.test.ts` impide que esta opción aparezca fuera de acá.
 */
export const EMPRESA_DE_PRUEBA_ID = "empresa_principal";

/**
 * La empresa TESTIGO (ADR-022): una segunda empresa ACTIVE, vacía y permanente en las bases de prueba. Con dos empresas activas el respaldo «la única empresa activa» de
 * `app_empresa_actual()` ya no devuelve nada, así que cualquier fixture que olvide indicar la empresa falla enseguida (NOT NULL) en vez de pasar por casualidad.
 */
export const EMPRESA_TESTIGO_ID = "empresa_testigo";
export const DATOS_EMPRESA_TESTIGO = { id: EMPRESA_TESTIGO_ID, nombre: "Empresa testigo", slug: "testigo", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "ACTIVE" as const };

const global = globalThis as unknown as { clientesDeEmpresaDePrueba?: Map<string, PrismaClient> };

/**
 * Un cliente sobre `url` con `app.empresa_id = empresaId` desde que se abre la conexión. Se guarda en `globalThis` por (url, empresa): un pool por archivo de test
 * agotaría las conexiones de la base.
 */
export function clienteConEmpresaDePrueba(url: string, empresaId: string = EMPRESA_DE_PRUEBA_ID): PrismaClient {
  global.clientesDeEmpresaDePrueba ??= new Map();
  const clave = `${empresaId}@${url}`;
  const existente = global.clientesDeEmpresaDePrueba.get(clave);
  if (existente) return existente;
  const cliente = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, options: `-c app.empresa_id=${empresaId}` }) });
  global.clientesDeEmpresaDePrueba.set(clave, cliente);
  return cliente;
}

/**
 * Lo mismo que `clienteConEmpresaDePrueba`, pero un cliente NUEVO (sin guardar en `globalThis`: quien lo pide lo desconecta con `$disconnect()`) que además emite un evento
 * `query` por cada consulta que manda a la base, con el SQL real y sus parámetros. Para los tests que miran el SQL que genera Prisma (por ejemplo el `EXPLAIN` de
 * `test/persistencia/kardex-indices-de-saldo.test.ts`); el preset de empresa sigue viviendo solo en este archivo (`sin-empresa-por-defecto.test.ts`, regla c).
 */
export function clienteConEmpresaDePruebaConLogDeQueries(url: string, empresaId: string = EMPRESA_DE_PRUEBA_ID) {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: url, options: `-c app.empresa_id=${empresaId}` }),
    log: [{ emit: "event", level: "query" }],
  });
}
