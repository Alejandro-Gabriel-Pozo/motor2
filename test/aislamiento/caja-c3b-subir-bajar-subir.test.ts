import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";

/**
 * Caja y cobro, etapa C3b (docs/diseno-caja-c3-cuenta-de-cobro-y-marcas-2026-11-16.md, Q-C3-6): SUBIR, BAJAR y SUBIR la migración del índice único parcial «una cuenta de cobro ACTIVA por sucursal» sobre una base TEMPORAL con todo lo anterior
 * aplicado (C3 incluida) y datos de antes. Prueba: la verificación previa ABORTA con una sucursal que tiene dos activas y pasa con las inactivas extra; SUBIR (el índice existe y la base rechaza la segunda activa como el rol real de la app); la migración sobre
 * datos que la violan falla sin tocar nada; BAJAR (el catálogo queda IDÉNTICO al de antes y no se pierde ninguna fila; bajar dos veces no falla); SUBIR OTRA VEZ (idéntico a la primera subida). Contra Postgres local; nunca contra una base real.
 * MUTACIÓN que debe dejarlo en ROJO: quitar el `WHERE "activa"` del índice de la migración (medido el 2026-11-16: 2 de 5 en rojo, «2. SUBIR» y «4. SUBIR OTRA VEZ»: la definición del índice cambia y la base rechaza la inactiva extra) o borrar el `CREATE UNIQUE INDEX` (la base deja de rechazar la segunda activa).
 */
const RAIZ = join(__dirname, "../../prisma/migrations");
const NUEVA = "20261117120000_caja_c3b_una_cuenta_por_sucursal";
const INDICE = "CuentaDeCobro_una_activa_por_sucursal_key";
const E = "empresa_c3b";
const UUID = "00000000-0000-4000-8000-0000000000";

const archivo = (a: "migration.sql" | "down.sql" | "verificacion-previa.sql") => readFileSync(join(RAIZ, NUEVA, a), "utf8");
let base: BaseTemporalMigrada;
let hayRol = false;
const abiertas: Client[] = [];

const correr = (a: "migration.sql" | "down.sql" | "verificacion-previa.sql") => base.cliente.query(archivo(a));
const q = <T extends object = Record<string, unknown>>(texto: string, params: unknown[] = []) => base.cliente.query<T>(texto, params).then((r) => r.rows);

async function foto() {
  return {
    indices: await q(`SELECT tablename::text AS tabla, indexname::text AS nombre, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY 1, 2`),
    restricciones: await q(`SELECT conrelid::regclass::text AS tabla, conname::text AS nombre, pg_get_constraintdef(oid) AS definicion FROM pg_constraint WHERE connamespace = 'public'::regnamespace ORDER BY 1, 2`),
    columnas: await q(`SELECT table_name::text AS tabla, column_name::text AS columna, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' ORDER BY 1, 2`),
    politicas: await q(`SELECT tablename::text AS tabla, policyname::text AS nombre, qual, with_check FROM pg_policies WHERE schemaname = 'public' ORDER BY 1, 2`),
    privilegios: await q(`SELECT table_name::text AS tabla, grantee::text AS rol, privilege_type FROM information_schema.role_table_grants WHERE table_schema = 'public' AND grantee IN ('motor2_app', 'motor2_plataforma') ORDER BY 1, 2, 3`),
    disparadores: await q(`SELECT tgrelid::regclass::text AS tabla, tgname::text AS nombre FROM pg_trigger WHERE NOT tgisinternal ORDER BY 1, 2`),
    cuentas: await q(`SELECT "id", "sucursalId", "nombre", "activa" FROM "CuentaDeCobro" ORDER BY "id"`),
  };
}
type Foto = Awaited<ReturnType<typeof foto>>;

async function conectarComoApp(): Promise<Client> {
  const credenciales = new URL(process.env.DATABASE_URL as string);
  const destino = new URL(base.url);
  const c = new Client({
    host: destino.hostname,
    port: destino.port ? Number(destino.port) : 5432,
    user: decodeURIComponent(credenciales.username),
    password: decodeURIComponent(credenciales.password),
    database: decodeURIComponent(destino.pathname.replace(/^\//, "")),
  });
  await c.connect();
  abiertas.push(c);
  return c;
}

async function falla(c: Client, texto: string): Promise<{ code?: string; constraint?: string } | null> {
  await c.query("SAVEPOINT intento");
  try {
    await c.query(texto);
    await c.query("RELEASE SAVEPOINT intento");
    return null;
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT intento");
    return e as { code?: string; constraint?: string };
  }
}

async function comoApp(fn: (c: Client) => Promise<void>) {
  const app = await conectarComoApp();
  await app.query("BEGIN");
  try {
    await app.query("SELECT set_config('app.empresa_id', $1, true)", [E]);
    await app.query("SELECT set_config('app.sucursales_lectura', 'suc_a,suc_b', true)");
    await app.query("SELECT set_config('app.sucursales_escritura', 'suc_a,suc_b', true)");
    await fn(app);
  } finally {
    await app.query("ROLLBACK");
  }
}

const cuenta = (n: string, sucursal: string, nombre: string, activa: boolean) =>
  base.cliente.query(`INSERT INTO "CuentaDeCobro" ("id","empresaId","sucursalId","tipo","nombre","activa") VALUES ('${UUID}${n}',$1,$2,'TERMINAL',$3,$4)`, [E, sucursal, nombre, activa]);

beforeAll(async () => {
  base = await crearBaseTemporalMigrada();
  hayRol = (await base.cliente.query("SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app'")).rowCount === 1;
  if (!hayRol) return;
  await base.aplicarAntesDe(NUEVA);
  const c = base.cliente;
  await c.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO motor2_app`);
  await c.query(`INSERT INTO "Empresa" ("id","nombre","slug","zonaHoraria","moneda","estado") VALUES ($1,$1,$1,'America/Argentina/Buenos_Aires','ARS','ACTIVE')`, [E]);
  await c.query(`INSERT INTO "Sucursal" ("id","empresaId","nombre") VALUES ('suc_a',$1,'Centro'), ('suc_b',$1,'Norte')`, [E]);
}, 300_000);

afterAll(async () => {
  await Promise.all(abiertas.map((c) => c.end().catch(() => undefined)));
  await base?.eliminar();
});

describe("Caja C3b: subir, bajar y subir (una cuenta de cobro activa por sucursal)", () => {
  let antes: Foto;
  let arribaLaPrimeraVez: Foto;

  async function comprobarArriba(etiqueta: string) {
    const f = await foto();
    expect(f.indices.filter((i) => i.nombre === INDICE).map((i) => i.indexdef), `${etiqueta}: el índice único parcial existe`).toEqual([
      `CREATE UNIQUE INDEX "${INDICE}" ON public."CuentaDeCobro" USING btree ("empresaId", "sucursalId") WHERE activa`,
    ]);
    await comoApp(async (c) => {
      expect(await falla(c, `UPDATE "CuentaDeCobro" SET "activa" = true WHERE "id" = '${UUID}12'`), `${etiqueta}: activar una inactiva en una sucursal que ya tiene activa`).toMatchObject({ code: "23505", constraint: INDICE });
      expect(await falla(c, `INSERT INTO "CuentaDeCobro" ("id","sucursalId","tipo","nombre") VALUES ('${UUID}13','suc_a','QR','Otra activa')`), `${etiqueta}: segunda activa de la sucursal`).toMatchObject({ code: "23505", constraint: INDICE });
      expect(await falla(c, `INSERT INTO "CuentaDeCobro" ("id","sucursalId","tipo","nombre","activa") VALUES ('${UUID}14','suc_a','QR','Otra inactiva',false)`), `${etiqueta}: una inactiva extra sí`).toBeNull();
      expect(await falla(c, `INSERT INTO "CuentaDeCobro" ("id","sucursalId","tipo","nombre") VALUES ('${UUID}15','suc_b','QR','Activa de Norte')`), `${etiqueta}: otra sucursal, otra activa`).toBeNull();
    });
    return f;
  }

  it("0. la migración existe, avisa que requiere autorización, trae down.sql y verificación previa (solo lectura)", () => {
    expect(archivo("migration.sql").split("\n")[0]).toContain("REQUIERE AUTORIZACIÓN EXPRESA");
    expect(archivo("verificacion-previa.sql")).toContain("SOLO LECTURA");
    expect(archivo("down.sql").length).toBeGreaterThan(0);
  });

  it("1. la verificación previa ABORTA con una sucursal con dos activas (nombrándola), la migración falla sin tocar nada y, con las sobrantes desactivadas, ambas pasan", async () => {
    if (!hayRol) return;
    await cuenta("10", "suc_a", "Posnet 1", true);
    await cuenta("11", "suc_a", "Posnet 2", true);
    await cuenta("12", "suc_a", "Posnet viejo", false);
    antes = await foto();
    await expect(correr("verificacion-previa.sql")).rejects.toThrow(/1 sucursal\(es\) con más de una cuenta de cobro activa: empresa_c3b\/suc_a \(2 activas\)/);
    await expect(correr("migration.sql")).rejects.toMatchObject({ code: "23505" });
    expect(await foto(), "la migración abortada no dejó nada a medias").toEqual(antes);
    await base.cliente.query(`UPDATE "CuentaDeCobro" SET "activa" = false WHERE "id" = '${UUID}11'`);
    await correr("verificacion-previa.sql");
    antes = await foto();
  });

  it("2. SUBIR: el índice existe, la base rechaza la segunda activa como el rol de la app y no toca ninguna fila", async () => {
    if (!hayRol) return;
    await correr("migration.sql");
    arribaLaPrimeraVez = await comprobarArriba("primera subida");
    expect(arribaLaPrimeraVez.cuentas, "las filas de antes siguen iguales").toEqual(antes.cuentas);
    await expect(correr("verificacion-previa.sql"), "con el índice ya creado la previa sigue pasando (no hay dos activas)").resolves.toBeDefined();
  });

  it("3. BAJAR: el catálogo queda IDÉNTICO al de antes, no se pierde ninguna fila y bajar dos veces no falla", async () => {
    if (!hayRol) return;
    await correr("down.sql");
    expect(await foto()).toEqual(antes);
    await correr("down.sql");
    expect(await foto(), "bajar dos veces no cambia nada").toEqual(antes);
  });

  it("4. SUBIR OTRA VEZ: idéntico a la primera subida", async () => {
    if (!hayRol) return;
    await correr("migration.sql");
    expect(await comprobarArriba("segunda subida")).toEqual(arribaLaPrimeraVez);
  });
});
