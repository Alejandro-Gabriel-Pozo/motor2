import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";

/**
 * Caja y cobro, etapa C2 (docs/diseno-caja-c2-jornada-y-cierre-del-dia-2026-11-16.md, nivel 6): SUBIR, BAJAR y SUBIR la migración de la jornada y su migración de políticas de alcance sobre una base TEMPORAL migrada hasta C1 y con datos de antes (una
 * sesión de C1, que recibe su jornada al subir). Prueba: SUBIR (cinco tablas, tres columnas, reglas, RLS por empresa y por sucursal, privilegios sin DELETE ni TRUNCATE, nada de antes se toca, la jornada de la sesión que ya existía);
 * BAJAR CON DATOS (la reversa ABORTA sin dejar nada a medias, por cada tipo de dato que se perdería); BAJAR SIN DATOS (el catálogo queda IDÉNTICO al de C1; bajar dos veces no falla); SUBIR OTRA VEZ (idéntico a la primera subida).
 * Contra Postgres local; nunca contra una base real.
 */
const RAIZ = join(__dirname, "../../prisma/migrations");
const C1_RLS = "20261117111000_rls_sucursal_caja_c1";
const TABLA = "20261117120000_caja_c2_jornada";
const RLS = "20261117121000_rls_sucursal_caja_c2";
const E = "empresa_caja2";
const OTRA = "empresa_caja2_otra";

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
    funciones: await q(`SELECT p.proname::text AS nombre, pg_get_function_arguments(p.oid) AS argumentos, md5(p.prosrc) AS cuerpo FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace ORDER BY 1, 2`),
    datos: await q(`SELECT (SELECT count(*) FROM "Producto") AS productos, (SELECT count(*) FROM "Sucursal") AS sucursales, (SELECT count(*) FROM "Empresa") AS empresas, (SELECT count(*) FROM "SesionCaja") AS sesiones, (SELECT count(*) FROM "MovimientoCaja") AS movimientos`),
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

const NUEVAS = ["ConformeDeJornada", "ControlDeJornadaCerrada", "CorreccionDeMedio", "DeclaracionDeTotal", "JornadaDeSucursal"];
const U = "00000000-0000-4000-8000-0000000000";

beforeAll(async () => {
  base = await crearBaseTemporalMigrada();
  hayRol = (await base.cliente.query("SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app'")).rowCount === 1;
  if (!hayRol) return;
  await base.aplicarHasta(C1_RLS);
  const c = base.cliente;
  await c.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO motor2_app`);
  for (const [empresa, sufijo] of [[E, "a"], [OTRA, "x"]] as const) {
    await c.query(`INSERT INTO "Empresa" ("id","nombre","slug","zonaHoraria","moneda","estado") VALUES ($1,$1,$1,'America/Argentina/Buenos_Aires','ARS','ACTIVE')`, [empresa]);
    await c.query(`INSERT INTO "Sucursal" ("id","empresaId","nombre") VALUES ('suc_${sufijo}',$1,'Centro')`, [empresa]);
  }
  await c.query(`INSERT INTO "Sucursal" ("id","empresaId","nombre") VALUES ('suc_b',$1,'Norte')`, [E]);
  await c.query(`INSERT INTO "User" ("id","email") VALUES ('u_caja2','caja2@ejemplo.test')`);
  // Datos de C1 de antes de subir C2: una caja con su efectivo y una sesión abierta (sin hora de corte ni jornada: no existían).
  await c.query(`INSERT INTO "Caja" ("id","empresaId","sucursalId","nombre") VALUES ('${U}c1',$1,'suc_a','Caja 1')`, [E]);
  await c.query(`INSERT INTO "MedioDePago" ("id","empresaId","tipo") VALUES ('${U}e1',$1,'EFECTIVO')`, [E]);
  await c.query(
    `INSERT INTO "SesionCaja" ("id","empresaId","sucursalId","cajaId","estado","fechaDeNegocio","zonaHoraria","abiertaEn","abiertaPorId","claveIdempotencia","huella") VALUES ('${U}51',$1,'suc_a','${U}c1','ABIERTA','2026-01-15','America/Argentina/Buenos_Aires','2026-01-15T15:00:00Z','u_caja2','${U}a1','${"a".repeat(64)}')`,
    [E],
  );
}, 300_000);

afterAll(async () => {
  await Promise.all(abiertas.map((c) => c.end().catch(() => undefined)));
  await base?.eliminar();
});

describe("Caja C2: subir, bajar y subir (cinco tablas y tres columnas, con su migración de políticas)", () => {
  let antes: Foto;
  let arribaLaPrimeraVez: Foto;

  async function comprobarArriba(etiqueta: string) {
    const f = await foto();
    for (const t of NUEVAS) {
      expect(f.rls.find((r) => r.tabla === t), `${etiqueta}: RLS de ${t}`).toEqual({ tabla: t, rls: true, forzado: false });
      expect(f.politicas.filter((p) => p.tabla === t).map((p) => p.nombre), `${etiqueta}: políticas de ${t}`).toEqual(["aislamiento_empresa", "alcance_sucursal_delete", "alcance_sucursal_insert", "alcance_sucursal_select", "alcance_sucursal_update"]);
      expect(f.privilegios.filter((p) => p.tabla === t).map((p) => p.privilege_type), `${etiqueta}: ${t} la app lee y agrega; ni DELETE ni TRUNCATE ni nada para plataforma`).toEqual(t === "JornadaDeSucursal" ? ["SELECT"] : ["INSERT", "SELECT"]);
    }
    expect(f.privilegiosDeColumna.filter((p) => p.tabla === "JornadaDeSucursal" && p.privilege_type === "INSERT").map((p) => p.columna), `${etiqueta}: la jornada solo se crea con su identidad`).toEqual(["empresaId", "fechaDeNegocio", "id", "sucursalId"]);
    expect(f.privilegiosDeColumna.filter((p) => p.tabla === "JornadaDeSucursal" && p.privilege_type === "UPDATE").map((p) => p.columna), `${etiqueta}: la jornada solo cambia su estado y sus marcas`).toEqual(["auditoriaIniciadaEn", "auditoriaIniciadaPorId", "cerradaEn", "cerradaPorId", "estado", "huellaDeCierre", "observacion"]);
    expect(f.columnas.filter((x) => x.columna === "horaDeCorte").map((x) => [x.tabla, x.data_type, x.is_nullable, x.column_default]).sort(), `${etiqueta}: la hora de corte`).toEqual([["SesionCaja", "time without time zone", "NO", "'00:00:00'::time without time zone"], ["Sucursal", "time without time zone", "NO", "'00:00:00'::time without time zone"]]);
    expect(f.datos, `${etiqueta}: no toca los datos de antes`).toEqual(antes.datos);
    // La sesión de C1 que ya existía recibió su jornada ABIERTA, una sola, con su fecha.
    expect(await q(`SELECT "estado", to_char("fechaDeNegocio",'YYYY-MM-DD') AS fecha FROM "JornadaDeSucursal"`), `${etiqueta}: la jornada de la sesión de antes`).toEqual([{ estado: "ABIERTA", fecha: "2026-01-15" }]);
    expect(await q(`SELECT "horaDeCorte"::text AS corte FROM "SesionCaja"`), `${etiqueta}: la sesión de antes quedó con corte 00:00`).toEqual([{ corte: "00:00:00" }]);
    // Humo como el rol real de la app: la base decide lo que el caso de uso no puede olvidar.
    await comoApp(E, { lectura: "suc_a,suc_b", escritura: "suc_a,suc_b" }, async (c) => {
      expect(await falla(c, `INSERT INTO "JornadaDeSucursal" ("id","sucursalId","fechaDeNegocio") VALUES ('${U}71','suc_a','2026-01-16')`), `${etiqueta}: jornada de la sucursal propia`).toBeNull();
      expect(await falla(c, `INSERT INTO "JornadaDeSucursal" ("id","sucursalId","fechaDeNegocio") VALUES ('${U}72','suc_a','2026-01-16')`), `${etiqueta}: una jornada por sucursal y día`).toBe("23505");
      expect(await falla(c, `INSERT INTO "JornadaDeSucursal" ("id","sucursalId","fechaDeNegocio","estado") VALUES ('${U}73','suc_a','2026-01-17','CERRADA')`), `${etiqueta}: la app no crea una jornada con estado propio`).toBe("42501");
      expect(await falla(c, `INSERT INTO "JornadaDeSucursal" ("id","sucursalId","fechaDeNegocio") VALUES ('${U}74','suc_x','2026-01-17')`), `${etiqueta}: no escribe en la sucursal de otra empresa`).not.toBeNull();
      expect(await falla(c, `DELETE FROM "JornadaDeSucursal"`), `${etiqueta}: la app no borra`).toBe("42501");
      expect(await falla(c, `UPDATE "JornadaDeSucursal" SET "estado" = 'CERRADA' WHERE "id" = '${U}71'`), `${etiqueta}: ABIERTA no pasa directo a CERRADA (ni con las marcas incompletas)`).toBe("23514");
      expect(await falla(c, `UPDATE "JornadaDeSucursal" SET "estado" = 'EN_AUDITORIA', "auditoriaIniciadaEn" = now(), "auditoriaIniciadaPorId" = 'u_caja2' WHERE "id" = '${U}71'`), `${etiqueta}: ABIERTA pasa a EN_AUDITORIA`).toBeNull();
      expect(await falla(c, `UPDATE "JornadaDeSucursal" SET "fechaDeNegocio" = '2026-02-01' WHERE "id" = '${U}71'`), `${etiqueta}: la identidad no se cambia (sin UPDATE por privilegio)`).toBe("42501");
      expect(await falla(c, `INSERT INTO "ConformeDeJornada" ("id","sucursalId","jornadaId","conformePorId","conformeEn","claveIdempotencia","huella") VALUES ('${U}81','suc_a','${U}71','u_caja2',now(),'${U}b1','${"b".repeat(64)}')`), `${etiqueta}: el conforme entra con la jornada en cierre`).toBeNull();
      expect(await falla(c, `INSERT INTO "ConformeDeJornada" ("id","sucursalId","jornadaId","conformePorId","conformeEn","claveIdempotencia","huella") VALUES ('${U}82','suc_a','${U}71','u_caja2',now(),'${U}b2','${"b".repeat(64)}')`), `${etiqueta}: un conforme por jornada`).toBe("23505");
      expect(await falla(c, `INSERT INTO "ConformeDeJornada" ("id","sucursalId","jornadaId","conformePorId","conformeEn","claveIdempotencia","huella") VALUES ('${U}83','suc_b','${U}71','u_caja2',now(),'${U}b3','${"b".repeat(64)}')`), `${etiqueta}: la fila es de la sucursal de su jornada`).toBe("23514");
      expect(await falla(c, `DELETE FROM "ConformeDeJornada"`), `${etiqueta}: la app no borra el conforme`).toBe("42501");
      expect(await falla(c, `UPDATE "ConformeDeJornada" SET "conformeEn" = now()`), `${etiqueta}: el conforme no se edita`).toBe("42501");
    });
    // Otra empresa no ve la jornada de ésta (RLS por empresa) y la sucursal fuera del alcance tampoco se ve.
    await comoApp(OTRA, { lectura: "suc_x", escritura: "suc_x" }, async (c) => {
      await c.query(`SELECT 1`);
      expect((await c.query(`SELECT count(*)::int AS n FROM "JornadaDeSucursal"`)).rows[0].n, `${etiqueta}: otra empresa no ve la jornada`).toBe(0);
    });
    await comoApp(E, { lectura: "suc_b", escritura: "suc_b" }, async (c) => {
      expect((await c.query(`SELECT count(*)::int AS n FROM "JornadaDeSucursal"`)).rows[0].n, `${etiqueta}: fuera del alcance de sucursal no se ve la jornada de suc_a`).toBe(0);
    });
    // Las reglas de la base que no dependen del rol (como dueño, en una transacción que se deshace).
    await c0().query("BEGIN");
    expect(await falla(c0(), `UPDATE "Sucursal" SET "horaDeCorte" = '24:00' WHERE "id" = 'suc_a'`), `${etiqueta}: la hora de corte es menor que 24:00`).toBe("23514");
    expect(await falla(c0(), `UPDATE "MovimientoCaja" SET "clase" = 'AJUSTE' WHERE false`), `${etiqueta}: AJUSTE es una clase válida`).toBeNull();
    await c0().query("ROLLBACK");
    return f;
  }
  const c0 = () => base.cliente;

  it("1. SUBIR: tablas, columnas, reglas, RLS y privilegios; no toca nada de antes y le da su jornada a la sesión que ya existía", async () => {
    if (!hayRol) return;
    antes = await foto();
    for (const t of NUEVAS) expect(antes.rls.find((r) => r.tabla === t), `antes no existe ${t}`).toBeUndefined();
    await correr(TABLA, "migration.sql");
    await correr(RLS, "migration.sql");
    arribaLaPrimeraVez = await comprobarArriba("primera subida");
  });

  it("2. BAJAR CON DATOS: la reversa ABORTA sin dejar nada a medias, por cada tipo de dato que se perdería; la de políticas pasa (no es destructiva)", async () => {
    if (!hayRol) return;
    await correr(RLS, "down.sql");
    expect((await foto()).politicas.filter((p) => p.tabla === "JornadaDeSucursal").map((p) => p.nombre), "sin la migración de políticas queda solo la de empresa").toEqual(["aislamiento_empresa"]);

    // (a) una hora de corte distinta de 00:00 en una sucursal
    await base.cliente.query(`UPDATE "Sucursal" SET "horaDeCorte" = '06:00' WHERE "id" = 'suc_a'`);
    let conDatos = await foto();
    await expect(correr(TABLA, "down.sql")).rejects.toThrow(/sucursal\(es\) tienen una hora de corte distinta de 00:00/);
    expect(await foto(), "la reversa abortada no tocó nada").toEqual(conDatos);
    await base.cliente.query(`UPDATE "Sucursal" SET "horaDeCorte" = '00:00' WHERE "id" = 'suc_a'`);

    // (b) una jornada en cierre
    await base.cliente.query(`UPDATE "JornadaDeSucursal" SET "estado" = 'EN_AUDITORIA', "auditoriaIniciadaEn" = now(), "auditoriaIniciadaPorId" = 'u_caja2' WHERE "estado" = 'ABIERTA' AND "fechaDeNegocio" = '2026-01-15'`);
    conDatos = await foto();
    await expect(correr(TABLA, "down.sql")).rejects.toThrow(/jornada\(s\) en cierre o cerrada\(s\)/);
    expect(await foto(), "la reversa abortada no tocó nada").toEqual(conDatos);
    await base.cliente.query(`UPDATE "JornadaDeSucursal" SET "estado" = 'ABIERTA', "auditoriaIniciadaEn" = NULL, "auditoriaIniciadaPorId" = NULL WHERE "estado" = 'EN_AUDITORIA'`);

    // (c) una fila en una de las otras tablas (el conforme que se puso arriba, en la jornada que se vuelve a poner en cierre)
    await base.cliente.query(`UPDATE "JornadaDeSucursal" SET "estado" = 'EN_AUDITORIA', "auditoriaIniciadaEn" = now(), "auditoriaIniciadaPorId" = 'u_caja2' WHERE "fechaDeNegocio" = '2026-01-15'`);
    await base.cliente.query(`INSERT INTO "ConformeDeJornada" ("id","empresaId","sucursalId","jornadaId","conformePorId","conformeEn","claveIdempotencia","huella") SELECT '${U}91', "empresaId", "sucursalId", "id", 'u_caja2', now(), '${U}b9', '${"b".repeat(64)}' FROM "JornadaDeSucursal" WHERE "fechaDeNegocio" = '2026-01-15'`);
    conDatos = await foto();
    await expect(correr(TABLA, "down.sql")).rejects.toThrow(/la tabla ConformeDeJornada tiene 1 fila/);
    expect(await foto(), "la reversa abortada no tocó nada").toEqual(conDatos);
    await base.cliente.query(`DELETE FROM "ConformeDeJornada"`);
    await base.cliente.query(`UPDATE "JornadaDeSucursal" SET "estado" = 'ABIERTA', "auditoriaIniciadaEn" = NULL, "auditoriaIniciadaPorId" = NULL WHERE "estado" = 'EN_AUDITORIA'`);

    // (d) un movimiento AJUSTE
    await base.cliente.query(`INSERT INTO "MedioDePago" ("id","empresaId","tipo") VALUES ('${U}e2',$1,'QR')`, [E]);
    await base.cliente.query(`INSERT INTO "MovimientoCaja" ("id","empresaId","sucursalId","sesionId","clase","medioDePagoId","importe","motivo","creadoPorId") VALUES ('${U}a2',$1,'suc_a','${U}51','AJUSTE','${U}e2',5,'Prueba','u_caja2')`, [E]);
    conDatos = await foto();
    await expect(correr(TABLA, "down.sql")).rejects.toThrow(/hay 1 movimiento\(s\) AJUSTE/);
    expect(await foto(), "la reversa abortada no tocó nada").toEqual(conDatos);
    await base.cliente.query(`DELETE FROM "MovimientoCaja" WHERE "clase" = 'AJUSTE'`);
    await base.cliente.query(`DELETE FROM "MedioDePago" WHERE "id" = '${U}e2'`);
  });

  it("3. BAJAR SIN DATOS: el catálogo queda IDÉNTICO al de C1 (también las funciones); las reversas son idempotentes", async () => {
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
