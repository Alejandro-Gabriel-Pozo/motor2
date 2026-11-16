import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";

/**
 * Caja y cobro, etapa C2b (docs/diseno-caja-c2-jornada-y-cierre-del-dia-2026-11-16.md, §7, nivel 6): SUBIR, BAJAR y SUBIR la migración de la foto congelada de la conciliación por medio y su migración de políticas de alcance sobre una base TEMPORAL migrada hasta C2.
 * Prueba: SUBIR (tres tablas, RLS por empresa y por sucursal, privilegios SELECT e INSERT sin UPDATE, DELETE ni TRUNCATE, disparadores, nada de antes se toca); BAJAR CON DATOS (la reversa ABORTA sin dejar nada a medias); BAJAR SIN DATOS (el catálogo queda IDÉNTICO al de C2; bajar dos
 * veces no falla); SUBIR OTRA VEZ (idéntico a la primera subida). Contra Postgres local; nunca contra una base real.
 */
const RAIZ = join(__dirname, "../../prisma/migrations");
const C2_RLS = "20261117115000_rls_sucursal_caja_c2";
const TABLA = "20261117116000_caja_c2b_conciliacion";
const RLS = "20261117117000_rls_sucursal_caja_c2b";
const E = "empresa_caja2b";
const OTRA = "empresa_caja2b_otra";
const NUEVAS = ["CierreDeCajaDeJornada", "ConciliacionDeCobroPorOrigen", "ConciliacionDeJornada"];
const U = "00000000-0000-4000-8000-0000000000";

const sql = (migracion: string, archivo: "migration.sql" | "down.sql") => readFileSync(join(RAIZ, migracion, archivo), "utf8");
let base: BaseTemporalMigrada;
let hayRol = false;
const abiertas: Client[] = [];
const correr = (migracion: string, archivo: "migration.sql" | "down.sql") => base.cliente.query(sql(migracion, archivo));
const q = <T extends object = Record<string, unknown>>(texto: string, params: unknown[] = []) => base.cliente.query<T>(texto, params).then((r) => r.rows);

async function foto() {
  return {
    columnas: await q(`SELECT table_name::text AS tabla, column_name::text AS columna, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' ORDER BY 1, 2`),
    indices: await q(`SELECT tablename::text AS tabla, indexname::text AS nombre, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY 1, 2`),
    restricciones: await q(`SELECT conrelid::regclass::text AS tabla, conname::text AS nombre, pg_get_constraintdef(oid) AS definicion FROM pg_constraint WHERE connamespace = 'public'::regnamespace ORDER BY 1, 2`),
    politicas: await q(`SELECT tablename::text AS tabla, policyname::text AS nombre, permissive, roles::text AS roles, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public' ORDER BY 1, 2`),
    rls: await q(`SELECT relname::text AS tabla, relrowsecurity AS rls, relforcerowsecurity AS forzado FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' ORDER BY 1`),
    privilegios: await q(`SELECT table_name::text AS tabla, grantee::text AS rol, privilege_type FROM information_schema.role_table_grants WHERE table_schema = 'public' AND grantee IN ('motor2_app', 'motor2_plataforma') ORDER BY 1, 2, 3`),
    disparadores: await q(`SELECT replace(tgrelid::regclass::text, '"', '') AS tabla, tgname::text AS nombre FROM pg_trigger WHERE NOT tgisinternal ORDER BY 1, 2`),
    funciones: await q(`SELECT p.proname::text AS nombre, pg_get_function_arguments(p.oid) AS argumentos, md5(p.prosrc) AS cuerpo FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace ORDER BY 1, 2`),
    datos: await q(`SELECT (SELECT count(*) FROM "Sucursal") AS sucursales, (SELECT count(*) FROM "Empresa") AS empresas`),
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

async function falla(c: Client, texto: string): Promise<string | null> {
  await c.query("SAVEPOINT intento");
  try {
    await c.query(texto);
    await c.query("RELEASE SAVEPOINT intento");
    return null;
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT intento");
    return (e as { code?: string }).code ?? "sin código";
  }
}

async function comoApp(empresa: string, alcance: { lectura: string; escritura: string }, fn: (c: Client) => Promise<void>) {
  const app = await conectarComoApp();
  await app.query("BEGIN");
  try {
    await app.query("SELECT set_config('app.empresa_id', $1, true)", [empresa]);
    await app.query("SELECT set_config('app.sucursales_lectura', $1, true)", [alcance.lectura]);
    await app.query("SELECT set_config('app.sucursales_escritura', $1, true)", [alcance.escritura]);
    await fn(app);
  } finally {
    await app.query("ROLLBACK");
  }
}

beforeAll(async () => {
  base = await crearBaseTemporalMigrada();
  hayRol = (await base.cliente.query("SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app'")).rowCount === 1;
  if (!hayRol) return;
  await base.aplicarHasta(C2_RLS);
  const c = base.cliente;
  await c.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO motor2_app`);
  for (const [empresa, sufijo] of [[E, "a"], [OTRA, "x"]] as const) {
    await c.query(`INSERT INTO "Empresa" ("id","nombre","slug","zonaHoraria","moneda","estado") VALUES ($1,$1,$1,'America/Argentina/Buenos_Aires','ARS','ACTIVE')`, [empresa]);
    await c.query(`INSERT INTO "Sucursal" ("id","empresaId","nombre") VALUES ('suc_${sufijo}',$1,'Centro')`, [empresa]);
  }
  await c.query(`INSERT INTO "User" ("id","email") VALUES ('u_caja2b','caja2b@ejemplo.test')`);
  await c.query(`INSERT INTO "MedioDePago" ("id","empresaId","tipo") VALUES ('${U}e1',$1,'EFECTIVO')`, [E]);
}, 300_000);

afterAll(async () => {
  await Promise.all(abiertas.map((c) => c.end().catch(() => undefined)));
  await base?.eliminar();
});

describe("Caja C2b: subir, bajar y subir (la foto congelada de la conciliación, con su migración de políticas)", () => {
  let antes: Foto;
  let arribaLaPrimeraVez: Foto;

  async function comprobarArriba(etiqueta: string) {
    const f = await foto();
    for (const t of NUEVAS) {
      expect(f.rls.find((r) => r.tabla === t), `${etiqueta}: RLS de ${t}`).toEqual({ tabla: t, rls: true, forzado: false });
      expect(f.politicas.filter((p) => p.tabla === t).map((p) => p.nombre), `${etiqueta}: políticas de ${t}`).toEqual(["aislamiento_empresa", "alcance_sucursal_delete", "alcance_sucursal_insert", "alcance_sucursal_select", "alcance_sucursal_update"]);
      expect(f.privilegios.filter((p) => p.tabla === t).map((p) => p.privilege_type), `${etiqueta}: ${t} la app lee y agrega; ni UPDATE ni DELETE ni TRUNCATE ni nada para plataforma`).toEqual(["INSERT", "SELECT"]);
    }
    expect(f.disparadores.filter((d) => NUEVAS.includes(String(d.tabla))).map((d) => d.nombre).sort(), `${etiqueta}: sus disparadores`).toEqual(["CierreDeCajaDeJornada_validar", "CierreDeCajaDeJornada_verificar", "ConciliacionDeCobroPorOrigen_validar", "ConciliacionDeJornada_validar"]);
    expect(f.datos, `${etiqueta}: no toca los datos de antes`).toEqual(antes.datos);
    // Humo como el rol real de la app: la base no deja sembrar una foto fuera de la transacción del cierre.
    await comoApp(E, { lectura: "suc_a", escritura: "suc_a" }, async (c) => {
      await c.query(`INSERT INTO "JornadaDeSucursal" ("id","sucursalId","fechaDeNegocio") VALUES ('${U}71','suc_a','2026-01-16')`);
      expect(await falla(c, `INSERT INTO "CierreDeCajaDeJornada" ("id","sucursalId","jornadaId","congeladoEn","congeladoPorId") VALUES ('${U}72','suc_a','${U}71',now(),'u_caja2b')`), `${etiqueta}: con la jornada abierta no hay foto`).not.toBeNull();
      expect(await falla(c, `UPDATE "ConciliacionDeJornada" SET "explicacion" = 'x'`), `${etiqueta}: la foto no se edita`).toBe("42501");
      expect(await falla(c, `DELETE FROM "CierreDeCajaDeJornada"`), `${etiqueta}: la foto no se borra`).toBe("42501");
    });
    await comoApp(OTRA, { lectura: "suc_x", escritura: "suc_x" }, async (c) => {
      for (const t of NUEVAS) expect((await c.query(`SELECT count(*)::int AS n FROM "${t}"`)).rows[0].n, `${etiqueta}: otra empresa no ve ${t}`).toBe(0);
    });
    return f;
  }

  it("1. SUBIR: tablas, reglas, RLS y privilegios; no toca nada de antes", async () => {
    if (!hayRol) return;
    antes = await foto();
    for (const t of NUEVAS) expect(antes.rls.find((r) => r.tabla === t), `antes no existe ${t}`).toBeUndefined();
    await correr(TABLA, "migration.sql");
    await correr(RLS, "migration.sql");
    arribaLaPrimeraVez = await comprobarArriba("primera subida");
  });

  it("2. BAJAR CON DATOS: la reversa ABORTA sin dejar nada a medias; la de políticas pasa (no es destructiva)", async () => {
    if (!hayRol) return;
    await correr(RLS, "down.sql");
    expect((await foto()).politicas.filter((p) => p.tabla === "CierreDeCajaDeJornada").map((p) => p.nombre), "sin la migración de políticas queda solo la de empresa").toEqual(["aislamiento_empresa"]);
    // Una jornada nace CERRADA y su foto se escribe en la MISMA transacción (lo que exige la base): la cabecera (un día sin movimientos no lleva líneas).
    const c = base.cliente;
    await c.query("BEGIN");
    await c.query(`INSERT INTO "JornadaDeSucursal" ("id","empresaId","sucursalId","fechaDeNegocio","estado","auditoriaIniciadaEn","auditoriaIniciadaPorId","cerradaEn","cerradaPorId","huellaDeCierre") VALUES ('${U}f1',$1,'suc_a','2026-01-10','CERRADA',now(),'u_caja2b',now(),'u_caja2b','${"b".repeat(64)}')`, [E]);
    await c.query(`INSERT INTO "CierreDeCajaDeJornada" ("id","empresaId","sucursalId","jornadaId","congeladoEn","congeladoPorId") VALUES ('${U}c1',$1,'suc_a','${U}f1',now(),'u_caja2b')`, [E]);
    await c.query("COMMIT");
    const conDatos = await foto();
    await expect(correr(TABLA, "down.sql")).rejects.toThrow(/la tabla CierreDeCajaDeJornada tiene 1 fila/);
    expect(await foto(), "la reversa abortada no tocó nada").toEqual(conDatos);
    // Se limpia como dueño (la foto es historia: la app no podría), para poder bajar sin datos.
    await c.query(`ALTER TABLE "CierreDeCajaDeJornada" DISABLE TRIGGER USER`);
    await c.query(`DELETE FROM "CierreDeCajaDeJornada"`);
    await c.query(`ALTER TABLE "CierreDeCajaDeJornada" ENABLE TRIGGER USER`);
    await c.query(`ALTER TABLE "JornadaDeSucursal" DISABLE TRIGGER USER`);
    await c.query(`DELETE FROM "JornadaDeSucursal"`);
    await c.query(`ALTER TABLE "JornadaDeSucursal" ENABLE TRIGGER USER`);
  });

  it("3. BAJAR SIN DATOS: el catálogo queda IDÉNTICO al de C2 (también las funciones); las reversas son idempotentes", async () => {
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
