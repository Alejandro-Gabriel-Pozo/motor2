import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";

/**
 * Caja y cobro, etapa C1 (docs/diseno-caja-y-cobro-paridad-pedernal-2026-11-16.md, nivel 6): SUBIR, BAJAR y SUBIR las ocho tablas de caja y su migración de políticas de alcance sobre una base TEMPORAL migrada como
 * una real y con datos de antes. Prueba: SUBIR (tablas, reglas, RLS por empresa y por sucursal, privilegios sin DELETE ni TRUNCATE, nada de antes se toca); BAJAR CON DATOS (la reversa ABORTA sin dejar nada a medias);
 * BAJAR SIN DATOS (el catálogo queda IDÉNTICO al de antes; bajar dos veces no falla); SUBIR OTRA VEZ (idéntico a la primera subida). Contra Postgres local; nunca contra una base real.
 */
const RAIZ = join(__dirname, "../../prisma/migrations");
const TABLA = "20261117110000_caja_c1";
const RLS = "20261117111000_rls_sucursal_caja_c1";
const E = "empresa_caja";
const OTRA = "empresa_caja_otra";

const sql = (migracion: string, archivo: "migration.sql" | "down.sql") => readFileSync(join(RAIZ, migracion, archivo), "utf8");
let base: BaseTemporalMigrada;
let hayRol = false;
const abiertas: Client[] = [];

const correr = (migracion: string, archivo: "migration.sql" | "down.sql") => base.cliente.query(sql(migracion, archivo));
const q = <T extends object = Record<string, unknown>>(texto: string, params: unknown[] = []) => base.cliente.query<T>(texto, params).then((r) => r.rows);

/** Una foto del catálogo de `public`: lo que una migración puede tocar. */
async function foto() {
  return {
    columnas: await q(`SELECT table_name::text AS tabla, column_name::text AS columna, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' ORDER BY 1, 2`),
    indices: await q(`SELECT tablename::text AS tabla, indexname::text AS nombre, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY 1, 2`),
    restricciones: await q(`SELECT conrelid::regclass::text AS tabla, conname::text AS nombre, pg_get_constraintdef(oid) AS definicion FROM pg_constraint WHERE connamespace = 'public'::regnamespace ORDER BY 1, 2`),
    politicas: await q(`SELECT tablename::text AS tabla, policyname::text AS nombre, permissive, roles::text AS roles, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public' ORDER BY 1, 2`),
    rls: await q(`SELECT relname::text AS tabla, relrowsecurity AS rls, relforcerowsecurity AS forzado FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' ORDER BY 1`),
    privilegios: await q(`SELECT table_name::text AS tabla, grantee::text AS rol, privilege_type FROM information_schema.role_table_grants WHERE table_schema = 'public' AND grantee IN ('motor2_app', 'motor2_plataforma') ORDER BY 1, 2, 3`),
    privilegiosDeColumna: await q(`SELECT table_name::text AS tabla, column_name::text AS columna, grantee::text AS rol, privilege_type FROM information_schema.column_privileges WHERE table_schema = 'public' AND grantee IN ('motor2_app', 'motor2_plataforma') ORDER BY 1, 2, 3, 4`),
    disparadores: await q(`SELECT tgrelid::regclass::text AS tabla, tgname::text AS nombre FROM pg_trigger WHERE NOT tgisinternal ORDER BY 1, 2`),
    datos: await q(`SELECT (SELECT count(*) FROM "Producto") AS productos, (SELECT count(*) FROM "Sucursal") AS sucursales, (SELECT count(*) FROM "Empresa") AS empresas`),
  };
}
type Foto = Awaited<ReturnType<typeof foto>>;

/** Una conexión como `motor2_app` (el rol de la app, sujeto a la RLS) a la base temporal. */
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

/** El SQLSTATE con el que falla una sentencia (dentro de un SAVEPOINT), o `null` si anduvo. */
async function falla(c: Client, texto: string, params: unknown[] = []): Promise<string | null> {
  await c.query("SAVEPOINT intento");
  try {
    await c.query(texto, params);
    await c.query("RELEASE SAVEPOINT intento");
    return null;
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT intento");
    return (e as { code?: string }).code ?? "sin código";
  }
}

/** Fija la empresa y el alcance de la transacción abierta (como lo hace la app al empezar una). */
async function fijar(c: Client, empresa: string, alcance: { lectura?: string; escritura?: string }) {
  await c.query("SELECT set_config('app.empresa_id', $1, true)", [empresa]);
  if (alcance.lectura !== undefined) await c.query("SELECT set_config('app.sucursales_lectura', $1, true)", [alcance.lectura]);
  if (alcance.escritura !== undefined) await c.query("SELECT set_config('app.sucursales_escritura', $1, true)", [alcance.escritura]);
}

/** Corre `fn` como `motor2_app` dentro de una transacción que se deshace. */
async function comoApp(empresa: string, alcance: { lectura?: string; escritura?: string }, fn: (c: Client) => Promise<void>) {
  const app = await conectarComoApp();
  await app.query("BEGIN");
  try {
    await fijar(app, empresa, alcance);
    await fn(app);
  } finally {
    await app.query("ROLLBACK");
  }
}

const TABLAS = ["ArqueoBillete", "ArqueoCaja", "Caja", "Cobranza", "Cobro", "MedioDePago", "MovimientoCaja", "SesionCaja"];
const CON_SUCURSAL = ["ArqueoBillete", "ArqueoCaja", "Caja", "Cobranza", "Cobro", "MovimientoCaja", "SesionCaja"];

beforeAll(async () => {
  base = await crearBaseTemporalMigrada();
  hayRol = (await base.cliente.query("SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app'")).rowCount === 1;
  if (!hayRol) return;
  await base.aplicarAntesDe(TABLA);
  const c = base.cliente;
  await c.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO motor2_app`);
  for (const [empresa, sufijo] of [[E, "a"], [OTRA, "x"]] as const) {
    await c.query(`INSERT INTO "Empresa" ("id","nombre","slug","zonaHoraria","moneda","estado") VALUES ($1,$1,$1,'America/Argentina/Buenos_Aires','ARS','ACTIVE')`, [empresa]);
    await c.query(`INSERT INTO "Sucursal" ("id","empresaId","nombre") VALUES ('suc_${sufijo}',$1,'Centro')`, [empresa]);
  }
  await c.query(`INSERT INTO "User" ("id","email") VALUES ('u_caja','caja@ejemplo.test')`);
}, 300_000);

afterAll(async () => {
  await Promise.all(abiertas.map((c) => c.end().catch(() => undefined)));
  await base?.eliminar();
});

describe("Caja C1: subir, bajar y subir (ocho tablas, con su migración de políticas)", () => {
  let antes: Foto;
  let arribaLaPrimeraVez: Foto;
  const UUID = "00000000-0000-4000-8000-0000000000";

  async function comprobarArriba(etiqueta: string) {
    const f = await foto();
    for (const t of TABLAS) {
      expect(f.rls.find((r) => r.tabla === t), `${etiqueta}: RLS de ${t}`).toEqual({ tabla: t, rls: true, forzado: false });
      const politicas = f.politicas.filter((p) => p.tabla === t).map((p) => p.nombre);
      expect(politicas, `${etiqueta}: políticas de ${t}`).toEqual(CON_SUCURSAL.includes(t) ? ["aislamiento_empresa", "alcance_sucursal_delete", "alcance_sucursal_insert", "alcance_sucursal_select", "alcance_sucursal_update"] : ["aislamiento_empresa"]);
      const privilegios = f.privilegios.filter((p) => p.tabla === t).map((p) => p.privilege_type);
      expect(privilegios, `${etiqueta}: ${t} la app lee y agrega; ni DELETE ni TRUNCATE ni nada para plataforma`).toEqual(["INSERT", "SELECT"]);
      expect(await q(`SELECT count(*)::int AS n FROM "${t}"`), `${etiqueta}: ${t} nace vacía`).toEqual([{ n: 0 }]);
    }
    expect(f.privilegiosDeColumna.filter((p) => p.tabla === "SesionCaja" && p.privilege_type === "UPDATE").map((p) => p.columna), `${etiqueta}: la sesión solo cambia lo del cierre`).toEqual(["cerradaEn", "cerradaPorId", "estado", "observacion"]);
    expect(f.privilegiosDeColumna.filter((p) => p.tabla === "MedioDePago" && p.privilege_type === "UPDATE").map((p) => p.columna), `${etiqueta}: el medio solo cambia nombre y estado`).toEqual(["activo", "actualizadoEn", "nombre", "version"]);
    expect(f.datos, `${etiqueta}: no toca los datos de antes`).toEqual(antes.datos);
    // Humo como el rol real de la app: la base decide lo que el caso de uso no puede olvidar.
    await comoApp(E, { lectura: "suc_a", escritura: "suc_a" }, async (c) => {
      expect(await falla(c, `INSERT INTO "Caja" ("id","sucursalId","nombre") VALUES ('${UUID}01','suc_a','Caja 1')`), `${etiqueta}: caja de la sucursal propia`).toBeNull();
      expect(await falla(c, `INSERT INTO "Caja" ("id","sucursalId","nombre") VALUES ('${UUID}02','suc_a','Caja 2')`), `${etiqueta}: una sola caja por sucursal`).toBe("23505");
      expect(await falla(c, `INSERT INTO "Caja" ("id","sucursalId","nombre") VALUES ('${UUID}03','suc_x','Ajena')`), `${etiqueta}: no escribe en otra sucursal`).not.toBeNull();
      expect(await falla(c, `DELETE FROM "Caja"`), `${etiqueta}: la app no borra`).toBe("42501");
      expect(await falla(c, `INSERT INTO "MedioDePago" ("id","tipo") VALUES ('${UUID}04','EFECTIVO')`), `${etiqueta}: el efectivo`).toBeNull();
      expect(await falla(c, `INSERT INTO "MedioDePago" ("id","tipo") VALUES ('${UUID}05','EFECTIVO')`), `${etiqueta}: un solo efectivo por empresa`).toBe("23505");
      expect(await falla(c, `INSERT INTO "MedioDePago" ("id","tipo") VALUES ('${UUID}06','CHEQUE')`), `${etiqueta}: tipo cerrado`).toBe("23514");
      expect(await falla(c, `UPDATE "MedioDePago" SET "activo" = false WHERE "tipo" = 'EFECTIVO'`), `${etiqueta}: el efectivo no se desactiva`).toBe("23514");
      expect(await falla(c, `UPDATE "MedioDePago" SET "tipo" = 'QR'`), `${etiqueta}: el tipo es inmutable (sin UPDATE)`).toBe("42501");
    });
    return f;
  }

  it("1. SUBIR: tablas, reglas, RLS y privilegios; no toca nada de antes", async () => {
    if (!hayRol) return;
    antes = await foto();
    for (const t of TABLAS) expect(antes.rls.find((r) => r.tabla === t), `antes no existe ${t}`).toBeUndefined();
    await correr(TABLA, "migration.sql");
    await correr(RLS, "migration.sql");
    arribaLaPrimeraVez = await comprobarArriba("primera subida");
  });

  it("2. BAJAR CON DATOS: la reversa de esquema ABORTA sin dejar nada a medias; la de políticas pasa (no es destructiva)", async () => {
    if (!hayRol) return;
    await base.cliente.query(`INSERT INTO "Caja" ("id","empresaId","sucursalId","nombre") VALUES ('${UUID}10',$1,'suc_a','Caja 1')`, [E]);
    await correr(RLS, "down.sql");
    expect((await foto()).politicas.filter((p) => p.tabla === "Caja").map((p) => p.nombre), "sin la migración de políticas queda solo la de empresa").toEqual(["aislamiento_empresa"]);
    const conDatos = await foto();
    await expect(correr(TABLA, "down.sql")).rejects.toThrow(/No se puede bajar 20261117110000_caja_c1: la tabla Caja tiene 1 fila/);
    expect(await foto(), "la reversa abortada no tocó nada").toEqual(conDatos);
    await base.cliente.query(`DELETE FROM "Caja"`);
  });

  it("3. BAJAR SIN DATOS: el catálogo queda IDÉNTICO al de antes; las reversas son idempotentes", async () => {
    if (!hayRol) return;
    await correr(TABLA, "down.sql");
    expect(await foto()).toEqual(antes);
    await correr(TABLA, "down.sql");
    expect(await foto(), "bajar dos veces no cambia nada").toEqual(antes);
  });

  it("4. SUBIR OTRA VEZ: el catálogo es idéntico al de la primera subida y todo anda", async () => {
    if (!hayRol) return;
    await correr(TABLA, "migration.sql");
    await correr(RLS, "migration.sql");
    expect(await comprobarArriba("segunda subida")).toEqual(arribaLaPrimeraVez);
  });
});
