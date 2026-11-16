import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";

/**
 * Caja y cobro, etapa C1b (docs/diseno-caja-c1b-en-cierre-2026-11-16.md, nivel 10): SUBIR, BAJAR y SUBIR la migración del estado EN_CIERRE sobre una base TEMPORAL con C1 ya aplicada y con sesiones de antes (una ABIERTA y una CERRADA
 * en un solo paso, como las dejó C1). Prueba: SUBIR (columnas nulas, CHECK nuevos, función nueva, privilegio por columna; las filas de antes no cambian y la app puede iniciar el cierre); BAJAR CON EN_CIERRE (la reversa ABORTA sin
 * dejar nada a medias); BAJAR SIN EN_CIERRE (el catálogo y los cuerpos de las funciones quedan IDÉNTICOS a los de C1; bajar dos veces no falla); SUBIR OTRA VEZ (idéntico a la primera subida); y la cadena completa (bajar C1b, después
 * las dos de C1, y volver a bajar C1b no deja funciones huérfanas). Contra Postgres local; nunca contra una base real.
 */
const RAIZ = join(__dirname, "../../prisma/migrations");
const C1B = "20261117119000_caja_c1b_en_cierre";
const C1 = "20261117110000_caja_c1";
const RLS = "20261117111000_rls_sucursal_caja_c1";
const E = "empresa_c1b";

const sql = (migracion: string, archivo: "migration.sql" | "down.sql") => readFileSync(join(RAIZ, migracion, archivo), "utf8");
let base: BaseTemporalMigrada;
let hayRol = false;
const abiertas: Client[] = [];

const correr = (migracion: string, archivo: "migration.sql" | "down.sql") => base.cliente.query(sql(migracion, archivo));
const q = <T extends object = Record<string, unknown>>(texto: string, params: unknown[] = []) => base.cliente.query<T>(texto, params).then((r) => r.rows);

/** Una foto del catálogo de `public` (más el cuerpo de cada función de la caja): lo que una migración puede tocar. */
async function foto() {
  return {
    columnas: await q(`SELECT table_name::text AS tabla, column_name::text AS columna, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' ORDER BY 1, 2`),
    indices: await q(`SELECT tablename::text AS tabla, indexname::text AS nombre, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY 1, 2`),
    restricciones: await q(`SELECT conrelid::regclass::text AS tabla, conname::text AS nombre, pg_get_constraintdef(oid) AS definicion FROM pg_constraint WHERE connamespace = 'public'::regnamespace ORDER BY 1, 2`),
    politicas: await q(`SELECT tablename::text AS tabla, policyname::text AS nombre, permissive, roles::text AS roles, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public' ORDER BY 1, 2`),
    privilegios: await q(`SELECT table_name::text AS tabla, grantee::text AS rol, privilege_type FROM information_schema.role_table_grants WHERE table_schema = 'public' AND grantee IN ('motor2_app', 'motor2_plataforma') ORDER BY 1, 2, 3`),
    privilegiosDeColumna: await q(`SELECT table_name::text AS tabla, column_name::text AS columna, grantee::text AS rol, privilege_type FROM information_schema.column_privileges WHERE table_schema = 'public' AND grantee IN ('motor2_app', 'motor2_plataforma') ORDER BY 1, 2, 3, 4`),
    disparadores: await q(`SELECT tgrelid::regclass::text AS tabla, tgname::text AS nombre FROM pg_trigger WHERE NOT tgisinternal ORDER BY 1, 2`),
    funciones: await q(`SELECT proname::text AS nombre, md5(prosrc) AS cuerpo FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND (proname LIKE 'SesionCaja\\_%' OR proname IN ('Arqueo_validar', 'MovimientoCaja_validar', 'Cobranza_validar', 'Cobro_validar', 'Cobranza_cuadra')) ORDER BY 1`),
    datos: await q(`SELECT (SELECT count(*) FROM "Sucursal") AS sucursales, (SELECT count(*) FROM "Empresa") AS empresas`),
  };
}
type Foto = Awaited<ReturnType<typeof foto>>;

/** Las filas de caja que ya existían antes de C1b (solo las columnas de C1): no tienen que cambiar. */
const filasDeCaja = () =>
  q(`SELECT "id", "estado", "cerradaEn", "cerradaPorId", "observacion" FROM "SesionCaja" ORDER BY "id"`);

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

async function falla(c: Client, texto: string, params: unknown[] = []): Promise<string | null> {
  await c.query("SAVEPOINT intento");
  try {
    await c.query(texto, params);
    await c.query("RELEASE SAVEPOINT intento");
    return null;
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT intento");
    return (e as { code?: string; message?: string }).code ?? "sin código";
  }
}

async function comoApp(fn: (c: Client) => Promise<void>) {
  const app = await conectarComoApp();
  await app.query("BEGIN");
  try {
    await app.query("SELECT set_config('app.empresa_id', $1, true), set_config('app.sucursales_lectura', 'suc_c1b,suc_c1b_2', true), set_config('app.sucursales_escritura', 'suc_c1b,suc_c1b_2', true)", [E]);
    await fn(app);
  } finally {
    await app.query("ROLLBACK");
  }
}

const UUID = "00000000-0000-4000-8000-0000000000";
const HUELLA = "a".repeat(64);
const CAJA = `${UUID}01`;
const EFECTIVO = `${UUID}02`;
const S_ABIERTA = `${UUID}03`;
const S_CERRADA = `${UUID}04`;
const CAJA_B = `${UUID}05`;

beforeAll(async () => {
  base = await crearBaseTemporalMigrada();
  hayRol = (await base.cliente.query("SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app'")).rowCount === 1;
  if (!hayRol) return;
  // Como el de C1: la app tiene todo sobre las tablas de antes; las migraciones de caja recortan después lo suyo (C1 revoca y vuelve a dar).
  await base.aplicarAntesDe(C1);
  const c = base.cliente;
  await c.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO motor2_app`);
  await base.aplicarAntesDe(C1B);
  await c.query(`INSERT INTO "Empresa" ("id","nombre","slug","zonaHoraria","moneda","estado") VALUES ($1,$1,$1,'America/Argentina/Buenos_Aires','ARS','ACTIVE')`, [E]);
  await c.query(`INSERT INTO "Sucursal" ("id","empresaId","nombre") VALUES ('suc_c1b',$1,'Centro'), ('suc_c1b_2',$1,'Norte')`, [E]);
  await c.query(`INSERT INTO "User" ("id","email") VALUES ('u_c1b','c1b@ejemplo.test')`);
  // Lo que dejó C1: una caja con su efectivo, una sesión CERRADA en un solo paso (con su arqueo) y, en otra caja, una sesión ABIERTA con su fondo.
  await c.query(`INSERT INTO "Caja" ("id","empresaId","sucursalId","nombre") VALUES ($1,$3,'suc_c1b','Caja 1'), ($2,$3,'suc_c1b_2','Caja 1')`, [CAJA, CAJA_B, E]);
  await c.query(`INSERT INTO "MedioDePago" ("id","empresaId","tipo") VALUES ($1,$2,'EFECTIVO')`, [EFECTIVO, E]);
  const sesion = (id: string, caja: string, sucursal: string) =>
    c.query(`INSERT INTO "SesionCaja" ("id","empresaId","sucursalId","cajaId","estado","fechaDeNegocio","zonaHoraria","abiertaPorId","claveIdempotencia","huella") VALUES ($1,$2,$3,$4,'ABIERTA','2026-01-15','America/Argentina/Buenos_Aires','u_c1b',$5,$6)`, [id, E, sucursal, caja, `${UUID}9${id.slice(-1)}`, HUELLA]);
  const fondo = (id: string, sucursal: string) => c.query(`INSERT INTO "MovimientoCaja" ("id","empresaId","sucursalId","sesionId","clase","medioDePagoId","importe","creadoPorId") VALUES ($1,$2,$3,$4,'FONDO_INICIAL',$5,100.00,'u_c1b')`, [`${UUID}7${id.slice(-1)}`, E, sucursal, id, EFECTIVO]);
  await c.query("BEGIN");
  await sesion(S_CERRADA, CAJA, "suc_c1b");
  await fondo(S_CERRADA, "suc_c1b");
  await c.query(`INSERT INTO "ArqueoCaja" ("id","empresaId","sucursalId","sesionId","medioDePagoId","esperado","contado","conforme") VALUES ($1,$2,'suc_c1b',$3,$4,100.00,100.00,false)`, [`${UUID}60`, E, S_CERRADA, EFECTIVO]);
  await c.query(`INSERT INTO "ArqueoBillete" ("id","empresaId","sucursalId","sesionId","denominacion","cantidad") VALUES ($1,$2,'suc_c1b',$3,100,1)`, [`${UUID}61`, E, S_CERRADA]);
  await c.query(`UPDATE "SesionCaja" SET "estado" = 'CERRADA', "cerradaEn" = now(), "cerradaPorId" = 'u_c1b' WHERE "id" = $1`, [S_CERRADA]);
  await c.query("COMMIT");
  await sesion(S_ABIERTA, CAJA_B, "suc_c1b_2");
  await fondo(S_ABIERTA, "suc_c1b_2");
}, 300_000);

afterAll(async () => {
  await Promise.all(abiertas.map((c) => c.end().catch(() => undefined)));
  await base?.eliminar();
});

describe("Caja C1b (estado EN_CIERRE): subir, bajar y subir sobre una base con C1 aplicada y sesiones de antes", () => {
  let antes: Foto;
  let filasAntes: Record<string, unknown>[];
  let arribaLaPrimeraVez: Foto;

  async function comprobarArriba(etiqueta: string) {
    const f = await foto();
    const columnas = f.columnas.filter((x) => x.tabla === "SesionCaja" && String(x.columna).startsWith("cierreIniciado"));
    expect(columnas.map((x) => [x.columna, x.is_nullable]), `${etiqueta}: dos columnas nuevas, nulas`).toEqual([["cierreIniciadoEn", "YES"], ["cierreIniciadoPorId", "YES"]]);
    expect(f.restricciones.find((r) => r.nombre === "SesionCaja_estado_chk")?.definicion, `${etiqueta}: el CHECK de estados suma EN_CIERRE`).toContain("EN_CIERRE");
    expect(f.funciones.map((x) => x.nombre), `${etiqueta}: la función nueva existe`).toContain("SesionCaja_exigir_en_cierre");
    expect(f.privilegiosDeColumna.filter((p) => p.tabla === "SesionCaja" && p.privilege_type === "UPDATE").map((p) => p.columna), `${etiqueta}: la sesión cambia lo del cierre`).toEqual(["cerradaEn", "cerradaPorId", "cierreIniciadoEn", "cierreIniciadoPorId", "estado", "observacion"]);
    expect(f.privilegios.filter((p) => p.tabla === "SesionCaja").map((p) => p.privilege_type), `${etiqueta}: la app sigue sin DELETE`).toEqual(["INSERT", "SELECT"]);
    expect(await filasDeCaja(), `${etiqueta}: las sesiones de antes no cambiaron`).toEqual(filasAntes);
    // Humo como el rol real de la app sobre la sesión ABIERTA que dejó C1: iniciar el cierre, no cobrar, contar y volver.
    await comoApp(async (c) => {
      expect(await falla(c, `UPDATE "SesionCaja" SET "estado" = 'EN_CIERRE', "cierreIniciadoEn" = now(), "cierreIniciadoPorId" = 'u_c1b' WHERE "id" = $1`, [S_ABIERTA]), `${etiqueta}: iniciar el cierre`).toBeNull();
      expect(await falla(c, `INSERT INTO "MovimientoCaja" ("id","sucursalId","sesionId","clase","medioDePagoId","importe","motivo","creadoPorId") VALUES ($1,'suc_c1b_2',$2,'INGRESO_MANUAL',$3,1.00,'x','u_c1b')`, [`${UUID}80`, S_ABIERTA, EFECTIVO]), `${etiqueta}: en cierre no entra plata`).toBe("23514");
      expect(await falla(c, `INSERT INTO "ArqueoBillete" ("id","sucursalId","sesionId","denominacion","cantidad") VALUES ($1,'suc_c1b_2',$2,100,1)`, [`${UUID}81`, S_ABIERTA]), `${etiqueta}: en cierre entra el conteo`).toBeNull();
      expect(await falla(c, `UPDATE "SesionCaja" SET "estado" = 'CERRADA', "cerradaEn" = now(), "cerradaPorId" = 'u_c1b' WHERE "id" = $1`, [S_CERRADA]), `${etiqueta}: la cerrada no se toca`).toBe("23514");
      expect(await falla(c, `UPDATE "SesionCaja" SET "estado" = 'ABIERTA', "cierreIniciadoEn" = NULL, "cierreIniciadoPorId" = NULL WHERE "id" = $1`, [S_ABIERTA]), `${etiqueta}: cancelar el cierre`).toBeNull();
    });
    return f;
  }

  it("0. la migración existe, avisa que requiere autorización, tiene down.sql y verificación previa, y es posterior a las de C1", () => {
    expect(sql(C1B, "migration.sql").split("\n")[0]).toContain("REQUIERE AUTORIZACIÓN EXPRESA");
    expect(sql(C1B, "down.sql").length).toBeGreaterThan(0);
    expect(readFileSync(join(RAIZ, C1B, "verificacion-previa.sql"), "utf8").length).toBeGreaterThan(0);
    expect(C1B > RLS && RLS > C1).toBe(true);
  });

  it("1. SUBIR: columnas nulas, CHECK nuevos, función nueva y privilegio; las filas de antes no cambian", async () => {
    if (!hayRol) return;
    antes = await foto();
    filasAntes = await filasDeCaja();
    expect(antes.columnas.filter((x) => x.tabla === "SesionCaja" && String(x.columna).startsWith("cierreIniciado"))).toEqual([]);
    await correr(C1B, "migration.sql");
    arribaLaPrimeraVez = await comprobarArriba("primera subida");
  });

  it("2. BAJAR CON EN_CIERRE: la reversa ABORTA sin dejar nada a medias", async () => {
    if (!hayRol) return;
    await base.cliente.query(`UPDATE "SesionCaja" SET "estado" = 'EN_CIERRE', "cierreIniciadoEn" = now(), "cierreIniciadoPorId" = 'u_c1b' WHERE "id" = $1`, [S_ABIERTA]);
    const conEnCierre = await foto();
    await expect(correr(C1B, "down.sql")).rejects.toThrow(/No se puede bajar 20261117119000_caja_c1b_en_cierre: hay 1 sesion\(es\) de caja EN_CIERRE/);
    expect(await foto(), "la reversa abortada no tocó nada").toEqual(conEnCierre);
    await base.cliente.query(`UPDATE "SesionCaja" SET "estado" = 'ABIERTA', "cierreIniciadoEn" = NULL, "cierreIniciadoPorId" = NULL WHERE "id" = $1`, [S_ABIERTA]);
  });

  it("3. BAJAR SIN EN_CIERRE: el catálogo y los cuerpos de las funciones quedan IDÉNTICOS a los de C1; las reversas son idempotentes", async () => {
    if (!hayRol) return;
    await base.cliente.query(`DELETE FROM "ArqueoBillete" WHERE "sesionId" = $1`, [S_ABIERTA]);
    await correr(C1B, "down.sql");
    expect(await foto()).toEqual(antes);
    expect(await filasDeCaja(), "las sesiones de antes siguen igual").toEqual(filasAntes);
    await correr(C1B, "down.sql");
    expect(await foto(), "bajar dos veces no cambia nada").toEqual(antes);
  });

  it("4. SUBIR OTRA VEZ: el catálogo es idéntico al de la primera subida y todo anda", async () => {
    if (!hayRol) return;
    await correr(C1B, "migration.sql");
    expect(await comprobarArriba("segunda subida")).toEqual(arribaLaPrimeraVez);
  });

  it("5. CADENA: bajar C1b, las dos de C1 (vaciadas) y C1b otra vez no deja funciones huérfanas", async () => {
    if (!hayRol) return;
    await correr(C1B, "down.sql");
    for (const t of ["ArqueoBillete", "ArqueoCaja", "Cobro", "Cobranza", "MovimientoCaja", "SesionCaja", "MedioDePago", "Caja"]) await base.cliente.query(`DELETE FROM "${t}"`);
    await correr(RLS, "down.sql");
    await correr(C1, "down.sql");
    await correr(C1B, "down.sql");
    const funciones = await q<{ nombre: string }>(`SELECT proname::text AS nombre FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND (proname LIKE 'SesionCaja\\_%' OR proname IN ('Arqueo_validar', 'MovimientoCaja_validar', 'Cobranza_validar', 'Cobro_validar', 'Cobranza_cuadra'))`);
    expect(funciones, "ninguna función de caja queda huérfana").toEqual([]);
  });
});
