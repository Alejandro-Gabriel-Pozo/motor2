import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CANTIDAD_DE_POLITICAS_ESPERADAS, TABLAS_CON_POLITICA_DE_SUCURSAL } from "../setup/clasificacion-de-tablas";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";
import {
  MIGRACION_B1_FUNCIONES,
  MIGRACION_M2_CAMPOS_SENSIBLES,
  MIGRACION_P3_AGREGADO_DE_CUENTA,
  MIGRACIONES_DE_POLITICAS_DE_SUCURSAL,
} from "../setup/migraciones-de-alcance-de-sucursal";

/**
 * Paquete 1: SUBIR, BAJAR y SUBIR de las migraciones reales (M.2, P3 y B1 a B6) sobre una base TEMPORAL descartable (`crearBaseTemporalMigrada`: solo Postgres local, jamás `motor2_dev`,
 * `motor2_e2e` ni una base real). Es el ensayo que el plan pide hacer en una rama de Neon antes de aplicar, hecho acá en chico y con cada `down.sql` tal cual está en el repo.
 *
 * ATENCIÓN: las reversas de P3 (borra la tabla `AgregadoDeCuenta`) y de M.2 (borra la clave `producto_campos_sensibles` y sus permisos) son DESTRUCTIVAS: la prueba las corre sobre la base
 * temporal, que se borra al terminar. Nunca contra una base con datos que importen.
 *
 * Qué comprueba:
 *  1. ARRIBA (todo aplicado): 32 tablas × 4 = 128 políticas `alcance_sucursal_*`, todas RESTRICTIVE y `TO motor2_app`, y exactamente las de `TABLAS_CON_POLITICA_DE_SUCURSAL`; las dos funciones,
 *     con EXECUTE para `motor2_app` (y andan llamadas como ese rol); la tabla de P3 con su RLS; la clave de M.2.
 *  2. ABAJO: con los `down.sql` en orden inverso (B6 … B1, después `AgregadoDeCuenta`, después M.2), el catálogo queda IDÉNTICO al que había antes de M.2 (políticas, funciones, tablas, columnas,
 *     índices, restricciones, RLS, privilegios y la clave): 0 políticas de sucursal, 0 funciones, sin la tabla, sin la clave. Las filas de las tablas que no se borran (empresa, sucursal, mesa) siguen.
 *  3. ARRIBA OTRA VEZ: las mismas comprobaciones, y el catálogo es idéntico al de la primera subida.
 *  4. Bajar B1 con las políticas todavía puestas FALLA (una política en uso impide borrar la función): por eso B1 va última.
 */
const RAIZ = join(__dirname, "../../prisma/migrations");
const GRUPOS = MIGRACIONES_DE_POLITICAS_DE_SUCURSAL;
const SUBIDA = [MIGRACION_M2_CAMPOS_SENSIBLES, MIGRACION_P3_AGREGADO_DE_CUENTA, MIGRACION_B1_FUNCIONES, ...GRUPOS.map((g) => g.migracion)];
/** El orden de la reversa: B6 … B2, B1 (última de las de alcance), después P3 y después M.2. */
const BAJADA = [...GRUPOS.map((g) => g.migracion).reverse(), MIGRACION_B1_FUNCIONES, MIGRACION_P3_AGREGADO_DE_CUENTA, MIGRACION_M2_CAMPOS_SENSIBLES];

const E = "empresa_1p";
let base: BaseTemporalMigrada;
let hayRol = false;
let app: Client | null = null;

const sql = (migracion: string, archivo: "migration.sql" | "down.sql") => readFileSync(join(RAIZ, migracion, archivo), "utf8");
/** Una sola consulta con todo el archivo (protocolo simple de `pg`: una transacción implícita, como `psql -1`). */
const correr = (migracion: string, archivo: "migration.sql" | "down.sql") => base.cliente.query(sql(migracion, archivo));
const q = <T extends object = Record<string, unknown>>(texto: string, params: unknown[] = []) => base.cliente.query<T>(texto, params).then((r) => r.rows);

/** Una foto del catálogo de `public` que cubre todo lo que estas migraciones tocan: se compara antes de M.2, después de bajar todo y después de subir otra vez. */
async function foto() {
  return {
    politicas: await q(`SELECT tablename::text AS tabla, policyname::text AS nombre, permissive, roles::text AS roles, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public' ORDER BY 1, 2`),
    funciones: await q(`SELECT p.proname::text AS nombre, pg_get_function_identity_arguments(p.oid) AS args, pg_get_functiondef(p.oid) AS definicion FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' ORDER BY 1, 2`),
    columnas: await q(`SELECT table_name::text AS tabla, column_name::text AS columna, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' ORDER BY 1, ordinal_position`),
    indices: await q(`SELECT tablename::text AS tabla, indexname::text AS nombre, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY 1, 2`),
    restricciones: await q(`SELECT conrelid::regclass::text AS tabla, conname::text AS nombre, pg_get_constraintdef(oid) AS definicion FROM pg_constraint WHERE connamespace = 'public'::regnamespace ORDER BY 1, 2`),
    rls: await q(`SELECT relname::text AS tabla, relrowsecurity AS rls, relforcerowsecurity AS forzado FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' ORDER BY 1`),
    privilegios: await q(`SELECT table_name::text AS tabla, grantee::text AS rol, privilege_type FROM information_schema.role_table_grants WHERE table_schema = 'public' AND grantee IN ('motor2_app', 'motor2_plataforma') ORDER BY 1, 2, 3`),
    clave: await q(`SELECT (SELECT count(*) FROM "Accion" WHERE clave = 'producto_campos_sensibles')::int AS acciones, (SELECT count(*) FROM "PermisoRol" WHERE "accionClave" = 'producto_campos_sensibles')::int AS permisos, (SELECT count(*) FROM "CapacidadSucursal" WHERE "accionClave" = 'producto_campos_sensibles')::int AS capacidades`),
  };
}

/** Las comprobaciones de «todo aplicado». */
async function comprobarArriba(etiqueta: string) {
  const politicas = await q<{ tabla: string; nombre: string; tipo: string; comando: string; roles: string }>(
    `SELECT tablename::text AS tabla, policyname::text AS nombre, permissive AS tipo, cmd AS comando, roles::text AS roles FROM pg_policies WHERE schemaname = 'public' AND policyname LIKE 'alcance\\_sucursal\\_%' ORDER BY 1, 2`,
  );
  expect(politicas, `${etiqueta}: 32 tablas × 4 comandos`).toHaveLength(TABLAS_CON_POLITICA_DE_SUCURSAL.length * 4);
  expect(politicas).toHaveLength(128);
  expect([...new Set(politicas.map((p) => p.tabla))].sort(), `${etiqueta}: las tablas son exactamente las de la clasificación`).toEqual([...TABLAS_CON_POLITICA_DE_SUCURSAL].sort());
  for (const p of politicas) {
    expect(p.tipo, `${etiqueta}: ${p.tabla}/${p.nombre}`).toBe("RESTRICTIVE");
    expect(p.roles, `${etiqueta}: ${p.tabla}/${p.nombre}`).toBe("{motor2_app}");
  }
  for (const t of TABLAS_CON_POLITICA_DE_SUCURSAL) expect(politicas.filter((p) => p.tabla === t).map((p) => p.comando).sort(), `${etiqueta}: ${t}`).toEqual(["DELETE", "INSERT", "SELECT", "UPDATE"]);
  const total = (await q<{ n: string }>(`SELECT count(*) AS n FROM pg_policies WHERE schemaname = 'public'`))[0]!.n;
  expect(Number(total), `${etiqueta}: el total de políticas es el que sale de la clasificación (empresa + sucursal)`).toBe(CANTIDAD_DE_POLITICAS_ESPERADAS);

  const funciones = await q<{ nombre: string }>(`SELECT proname::text AS nombre FROM pg_proc WHERE proname LIKE 'app\\_sucursales\\_%' ORDER BY 1`);
  expect(funciones.map((f) => f.nombre), `${etiqueta}: las dos funciones`).toEqual(["app_sucursales_escritura", "app_sucursales_lectura"]);
  expect((await q<{ ok: boolean }>(`SELECT has_function_privilege('motor2_app', 'app_sucursales_lectura()', 'EXECUTE') AS ok`))[0]!.ok, `${etiqueta}: motor2_app puede ejecutar app_sucursales_lectura()`).toBe(true);
  expect((await q<{ ok: boolean }>(`SELECT has_function_privilege('motor2_app', 'app_sucursales_escritura()', 'EXECUTE') AS ok`))[0]!.ok, `${etiqueta}: motor2_app puede ejecutar app_sucursales_escritura()`).toBe(true);

  expect(await q(`SELECT 1 FROM pg_class WHERE relname = 'AgregadoDeCuenta' AND relnamespace = 'public'::regnamespace AND relrowsecurity`), `${etiqueta}: la tabla de P3, con RLS`).toHaveLength(1);
  expect((await foto()).clave, `${etiqueta}: la clave de M.2`).toEqual([{ acciones: 1, permisos: expect.any(Number), capacidades: expect.any(Number) }]);

  // Humo como el rol real de la app: las funciones andan, y sin alcance no se ve ninguna mesa; con lectura en la sucursal, la de esa sucursal.
  app ??= await conectarComoApp();
  await app.query("BEGIN");
  try {
    await app.query("SELECT set_config('app.empresa_id', $1, true)", [E]);
    expect((await app.query("SELECT app_sucursales_lectura() AS l")).rows[0].l, `${etiqueta}: sin variable, NULL`).toBeNull();
    expect((await app.query(`SELECT "id" FROM "Mesa"`)).rows, `${etiqueta}: sin alcance no se ve ninguna mesa (falla cerrado)`).toEqual([]);
    await app.query("SELECT set_config('app.sucursales_lectura', 'suc_1p', true)");
    expect((await app.query(`SELECT "id" FROM "Mesa"`)).rows, `${etiqueta}: con lectura en su sucursal se ve su mesa`).toEqual([{ id: "mesa_1p" }]);
  } finally {
    await app.query("ROLLBACK");
  }
}

/** Una conexión como `motor2_app` (el rol de la app, sujeto a RLS) a la base temporal. */
async function conectarComoApp(): Promise<Client> {
  const credenciales = new URL(process.env.DATABASE_URL as string);
  const destino = new URL(base.url);
  const cliente = new Client({
    host: destino.hostname,
    port: destino.port ? Number(destino.port) : 5432,
    user: decodeURIComponent(credenciales.username),
    password: decodeURIComponent(credenciales.password),
    database: decodeURIComponent(destino.pathname.replace(/^\//, "")),
  });
  await cliente.connect();
  return cliente;
}

let antesDeTodo: Awaited<ReturnType<typeof foto>>;
let arribaLaPrimeraVez: Awaited<ReturnType<typeof foto>>;

beforeAll(async () => {
  base = await crearBaseTemporalMigrada();
  hayRol = (await base.cliente.query("SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app'")).rowCount === 1;
  if (!hayRol) return; // sin el rol, `CREATE POLICY … TO motor2_app` falla: el archivo omite sus casos con motivo (como los demás tests de RLS).
  await base.aplicarAntesDe(MIGRACION_M2_CAMPOS_SENSIBLES);
  await base.cliente.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO motor2_app`);
  antesDeTodo = await foto();
  // Filas que NO se borran con ninguna reversa (empresa, sucursal, mesa): sobreviven a todo el ida y vuelta.
  await base.cliente.query(`INSERT INTO "Empresa" ("id","nombre","slug","zonaHoraria","moneda","estado") VALUES ($1,$1,$1,'America/Argentina/Buenos_Aires','ARS','ACTIVE')`, [E]);
  await base.cliente.query(`INSERT INTO "Sucursal" ("id","empresaId","nombre") VALUES ('suc_1p',$1,'Centro')`, [E]);
  await base.cliente.query(`INSERT INTO "Mesa" ("id","empresaId","sucursalId","numero") VALUES ('mesa_1p',$1,'suc_1p',1)`, [E]);
}, 120_000);

afterAll(async () => {
  await app?.end().catch(() => undefined);
  await base?.eliminar();
});

describe("Paquete 1: subir, bajar y subir (M.2, P3 y B1 a B6) sobre una base temporal", () => {
  it("1. SUBIR: aplica todas las migraciones y queda todo arriba (128 políticas, 2 funciones con EXECUTE para motor2_app, la tabla de P3 y la clave de M.2)", async (ctx) => {
    if (!hayRol) return ctx.skip();
    await base.aplicarRestantes();
    // Las seis migraciones del alcance existen y estaban en la lista de pendientes: la base las aplicó por su nombre.
    for (const m of SUBIDA) expect(sql(m, "migration.sql").length, m).toBeGreaterThan(0);
    await comprobarArriba("primera subida");
    arribaLaPrimeraVez = await foto();
    expect(arribaLaPrimeraVez.politicas.length, "sanidad de la foto").toBeGreaterThan(antesDeTodo.politicas.length + 127);
  });

  it("2. BAJAR: B1 no se puede bajar con las políticas puestas (una política en uso impide borrar la función)", async (ctx) => {
    if (!hayRol) return ctx.skip();
    await expect(correr(MIGRACION_B1_FUNCIONES, "down.sql")).rejects.toThrow(/depend/i);
    expect((await foto()).funciones.map((f) => f.nombre), "la reversa fallida no dejó nada a medias").toEqual(arribaLaPrimeraVez.funciones.map((f) => f.nombre));
  });

  it("3. BAJAR: con los down.sql en orden inverso (B6 … B1, AgregadoDeCuenta, M.2) el catálogo queda como estaba antes de M.2, y las filas que no se borran siguen", async (ctx) => {
    if (!hayRol) return ctx.skip();
    for (const m of BAJADA) await correr(m, "down.sql");
    const despues = await foto();
    expect(despues.politicas.filter((p) => String(p.nombre).startsWith("alcance_sucursal_")), "0 políticas de sucursal").toEqual([]);
    expect(await q(`SELECT proname FROM pg_proc WHERE proname LIKE 'app\\_sucursales\\_%'`), "0 funciones").toEqual([]);
    expect(await q(`SELECT 1 FROM pg_class WHERE relname = 'AgregadoDeCuenta' AND relnamespace = 'public'::regnamespace`), "sin la tabla de P3").toEqual([]);
    expect(despues.clave, "sin la clave producto_campos_sensibles").toEqual([{ acciones: 0, permisos: 0, capacidades: 0 }]);
    for (const k of Object.keys(antesDeTodo) as (keyof typeof antesDeTodo)[]) expect(despues[k], `catálogo «${k}» igual que antes de M.2`).toEqual(antesDeTodo[k]);
    expect(await q(`SELECT "id" FROM "Mesa"`), "los datos que ninguna reversa toca siguen").toEqual([{ id: "mesa_1p" }]);
  });

  it("4. SUBIR OTRA VEZ: las mismas comprobaciones, y el catálogo es idéntico al de la primera subida", async (ctx) => {
    if (!hayRol) return ctx.skip();
    for (const m of SUBIDA) await correr(m, "migration.sql");
    await comprobarArriba("segunda subida");
    const otraVez = await foto();
    for (const k of Object.keys(arribaLaPrimeraVez) as (keyof typeof arribaLaPrimeraVez)[]) expect(otraVez[k], `catálogo «${k}» igual que la primera vez`).toEqual(arribaLaPrimeraVez[k]);
    expect(await q(`SELECT "id" FROM "Mesa"`)).toEqual([{ id: "mesa_1p" }]);
  });

  it("5. Las reversas de las políticas son idempotentes (IF EXISTS): bajar dos veces no falla", async (ctx) => {
    if (!hayRol) return ctx.skip();
    for (const m of BAJADA.slice(0, GRUPOS.length)) {
      await correr(m, "down.sql");
      await correr(m, "down.sql");
    }
    expect((await foto()).politicas.filter((p) => String(p.nombre).startsWith("alcance_sucursal_"))).toEqual([]);
  });
});
