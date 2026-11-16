import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";

/**
 * Caja y cobro, etapa C3 (docs/diseno-caja-c3-cuenta-de-cobro-y-marcas-2026-11-16.md): SUBIR, BAJAR y SUBIR la migración de la cuenta de cobro y las marcas de tarjeta (y su migración de políticas de alcance) sobre una base TEMPORAL
 * con todo lo anterior aplicado (incluida la etapa C1) y datos de antes. Prueba: SUBIR (tablas y columnas nuevas, reglas, privilegios —la app solo LEE la lista global—, nada de antes se toca); BAJAR CON DATOS (la reversa ABORTA sin
 * dejar nada a medias); BAJAR SIN DATOS (el catálogo, los índices y el CÓDIGO de las tres funciones que C3 reemplaza quedan IDÉNTICOS a los de C1; bajar dos veces no falla); SUBIR OTRA VEZ (idéntico a la primera subida).
 * Contra Postgres local; nunca contra una base real.
 */
const RAIZ = join(__dirname, "../../prisma/migrations");
const C1 = "20261117110000_caja_c1";
const TABLA = "20261117130000_caja_c3_cuenta_de_cobro";
const RLS = "20261117131000_rls_sucursal_caja_c3";
const E = "empresa_c3";
const UUID = "00000000-0000-4000-8000-0000000000";

const sql = (migracion: string, archivo: "migration.sql" | "down.sql") => readFileSync(join(RAIZ, migracion, archivo), "utf8");
let base: BaseTemporalMigrada;
let hayRol = false;
const abiertas: Client[] = [];

const correr = (migracion: string, archivo: "migration.sql" | "down.sql") => base.cliente.query(sql(migracion, archivo));
const q = <T extends object = Record<string, unknown>>(texto: string, params: unknown[] = []) => base.cliente.query<T>(texto, params).then((r) => r.rows);

/** Una foto del catálogo de `public`: lo que una migración puede tocar, con el código de las funciones. */
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
    funciones: await q(`SELECT proname::text AS nombre, md5(prosrc) AS codigo FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname ~ '^(SesionCaja|MovimientoCaja|Cobro|Cobranza|Arqueo|CuentaDeCobro|ValorDeLista)' ORDER BY 1`),
    collations: await q(`SELECT collname::text AS nombre FROM pg_collation WHERE collnamespace = 'public'::regnamespace ORDER BY 1`),
    datos: await q(`SELECT (SELECT count(*) FROM "Producto") AS productos, (SELECT count(*) FROM "Sucursal") AS sucursales, (SELECT count(*) FROM "Empresa") AS empresas, (SELECT count(*) FROM "MedioDePago") AS medios`),
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

/** El SQLSTATE con el que falla una sentencia (dentro de un SAVEPOINT), o `null` si anduvo. */
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

async function comoApp(alcance: { lectura: string; escritura: string }, fn: (c: Client) => Promise<void>) {
  const app = await conectarComoApp();
  await app.query("BEGIN");
  try {
    await app.query("SELECT set_config('app.empresa_id', $1, true)", [E]);
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
  await base.aplicarAntesDe(C1);
  const c = base.cliente;
  await c.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO motor2_app`);
  await base.aplicarAntesDe(TABLA);
  await c.query(`INSERT INTO "Empresa" ("id","nombre","slug","zonaHoraria","moneda","estado") VALUES ($1,$1,$1,'America/Argentina/Buenos_Aires','ARS','ACTIVE')`, [E]);
  await c.query(`INSERT INTO "Sucursal" ("id","empresaId","nombre") VALUES ('suc_a',$1,'Centro'), ('suc_b',$1,'Norte')`, [E]);
  await c.query(`INSERT INTO "MedioDePago" ("id","empresaId","tipo") VALUES ('${UUID}20',$1,'EFECTIVO'), ('${UUID}21',$1,'TARJETA_DEBITO')`, [E]);
}, 300_000);

afterAll(async () => {
  await Promise.all(abiertas.map((c) => c.end().catch(() => undefined)));
  await base?.eliminar();
});

describe("Caja C3: subir, bajar y subir (cuenta de cobro, marcas de tarjeta y datos del cobro)", () => {
  let antes: Foto;
  let arribaLaPrimeraVez: Foto;

  async function comprobarArriba(etiqueta: string) {
    const f = await foto();
    expect(f.rls.find((r) => r.tabla === "CuentaDeCobro"), `${etiqueta}: RLS de CuentaDeCobro`).toEqual({ tabla: "CuentaDeCobro", rls: true, forzado: false });
    expect(f.politicas.filter((p) => p.tabla === "CuentaDeCobro").map((p) => p.nombre), `${etiqueta}: políticas de CuentaDeCobro`).toEqual(["aislamiento_empresa", "alcance_sucursal_delete", "alcance_sucursal_insert", "alcance_sucursal_select", "alcance_sucursal_update"]);
    expect(f.rls.find((r) => r.tabla === "ValorDeLista"), `${etiqueta}: la lista global NO lleva RLS`).toEqual({ tabla: "ValorDeLista", rls: false, forzado: false });
    expect(f.politicas.filter((p) => p.tabla === "ValorDeLista"), `${etiqueta}: ni políticas`).toEqual([]);
    expect(f.privilegios.filter((p) => p.tabla === "CuentaDeCobro").map((p) => `${p.rol}:${p.privilege_type}`), `${etiqueta}: la app lee y agrega la cuenta; ni DELETE ni nada para plataforma`).toEqual(["motor2_app:INSERT", "motor2_app:SELECT"]);
    expect(f.privilegios.filter((p) => p.tabla === "ValorDeLista").map((p) => `${p.rol}:${p.privilege_type}`), `${etiqueta}: la app SOLO LEE la lista global`).toEqual(["motor2_app:SELECT"]);
    expect(f.privilegiosDeColumna.filter((p) => p.tabla === "CuentaDeCobro" && p.privilege_type === "UPDATE").map((p) => p.columna), `${etiqueta}: la cuenta cambia nombre, identificador, sucursal y estado`).toEqual(["activa", "actualizadoEn", "identificadorExterno", "nombre", "sucursalId", "version"]);
    expect(f.privilegiosDeColumna.filter((p) => p.tabla === "MedioDePago" && p.privilege_type === "UPDATE").map((p) => p.columna), `${etiqueta}: el medio suma lo que pide`).toEqual(["activo", "actualizadoEn", "nombre", "pideCuotas", "pideCupon", "pideDni", "pideMarca", "pideUltimos4", "version"]);
    expect(await q(`SELECT "nombre", "fija" FROM "ValorDeLista" ORDER BY "fija", "nombre"`), `${etiqueta}: marcas sembradas`).toEqual([
      { nombre: "American Express", fija: false }, { nombre: "Cabal", fija: false }, { nombre: "Mastercard", fija: false }, { nombre: "Naranja X", fija: false }, { nombre: "Visa", fija: false }, { nombre: "Otra", fija: true },
    ]);
    expect(await q(`SELECT count(*)::int AS n FROM "CuentaDeCobro"`), `${etiqueta}: la cuenta nace vacía`).toEqual([{ n: 0 }]);
    expect(f.datos, `${etiqueta}: no toca los datos de antes`).toEqual(antes.datos);
    expect(await q(`SELECT count(*)::int AS n FROM "MedioDePago" WHERE "pideCupon" OR "pideUltimos4" OR "pideMarca" OR "pideCuotas" OR "pideDni"`), `${etiqueta}: los medios de antes no piden nada (todo nace cerrado)`).toEqual([{ n: 0 }]);
    // Humo como el rol real de la app.
    await comoApp({ lectura: "suc_a", escritura: "suc_a" }, async (c) => {
      expect(await falla(c, `INSERT INTO "CuentaDeCobro" ("id","sucursalId","tipo","nombre") VALUES ('${UUID}01','suc_a','TERMINAL','Posnet 1')`), `${etiqueta}: cuenta de la sucursal propia`).toBeNull();
      expect(await falla(c, `INSERT INTO "CuentaDeCobro" ("id","sucursalId","tipo","nombre") VALUES ('${UUID}02','suc_a','QR','POSNET 1')`), `${etiqueta}: nombre único sin mayúsculas`).toBe("23505");
      expect(await falla(c, `INSERT INTO "CuentaDeCobro" ("id","sucursalId","tipo","nombre") VALUES ('${UUID}03','suc_a','CHEQUE','X')`), `${etiqueta}: tipo cerrado`).toBe("23514");
      expect(await falla(c, `INSERT INTO "CuentaDeCobro" ("id","sucursalId","tipo","nombre") VALUES ('${UUID}04','suc_a','QR','<b>')`), `${etiqueta}: nombre por lista de permitidos`).toBe("23514");
      expect(await falla(c, `INSERT INTO "CuentaDeCobro" ("id","sucursalId","tipo","nombre","identificadorExterno") VALUES ('${UUID}05','suc_a','QR','Q','clave=1')`), `${etiqueta}: identificador por lista de permitidos`).toBe("23514");
      expect(await falla(c, `INSERT INTO "CuentaDeCobro" ("id","sucursalId","tipo","nombre") VALUES ('${UUID}06','suc_b','QR','Ajena')`), `${etiqueta}: no escribe en otra sucursal`).not.toBeNull();
      expect(await falla(c, `UPDATE "CuentaDeCobro" SET "tipo" = 'QR'`), `${etiqueta}: el tipo no se cambia (sin UPDATE)`).toBe("42501");
      expect(await falla(c, `DELETE FROM "CuentaDeCobro"`), `${etiqueta}: la app no borra`).toBe("42501");
      expect(await falla(c, `INSERT INTO "ValorDeLista" ("id","lista","nombre") VALUES ('${UUID}07','MARCAS_DE_TARJETA','Diners')`), `${etiqueta}: la app no agrega marcas`).toBe("42501");
      expect(await falla(c, `UPDATE "ValorDeLista" SET "activo" = false`), `${etiqueta}: la app no cambia marcas`).toBe("42501");
      expect(await falla(c, `UPDATE "MedioDePago" SET "pideCupon" = true WHERE "tipo" = 'TARJETA_DEBITO'`), `${etiqueta}: el débito puede pedir el cupón`).toBeNull();
      expect(await falla(c, `UPDATE "MedioDePago" SET "pideCuotas" = true WHERE "tipo" = 'TARJETA_DEBITO'`), `${etiqueta}: el débito no puede pedir cuotas`).toBe("23514");
      expect(await falla(c, `UPDATE "MedioDePago" SET "pideDni" = true WHERE "tipo" = 'EFECTIVO'`), `${etiqueta}: el efectivo no pide nada`).toBe("23514");
    });
    await comoApp({ lectura: "suc_b", escritura: "suc_b" }, async (c) => {
      await c.query(`SELECT 1`);
      expect(await q(`SELECT count(*)::int AS n FROM "CuentaDeCobro"`), "(el dueño ve la tabla vacía: el humo no la dejó escrita)").toEqual([{ n: 0 }]);
    });
    return f;
  }

  it("0. las migraciones existen, avisan que requieren autorización, traen down.sql y verificación previa", () => {
    expect(sql(TABLA, "migration.sql").split("\n")[0]).toContain("REQUIERE AUTORIZACIÓN EXPRESA");
    expect(sql(RLS, "migration.sql").split("\n")[0]).toContain("REQUIERE AUTORIZACIÓN EXPRESA");
    expect(readFileSync(join(RAIZ, TABLA, "verificacion-previa.sql"), "utf8")).toContain("SOLO LECTURA");
    expect(sql(TABLA, "down.sql").length).toBeGreaterThan(0);
  });

  it("1. SUBIR: tablas, columnas, reglas, RLS y privilegios; no toca nada de antes", async () => {
    if (!hayRol) return;
    antes = await foto();
    expect(antes.rls.find((r) => r.tabla === "CuentaDeCobro"), "antes no existe CuentaDeCobro").toBeUndefined();
    await correr(TABLA, "migration.sql");
    await correr(RLS, "migration.sql");
    arribaLaPrimeraVez = await comprobarArriba("primera subida");
  });

  it("2. BAJAR CON DATOS: la reversa de esquema ABORTA sin dejar nada a medias (cuentas, datos del cobro, medios que piden o marcas cambiadas)", async () => {
    if (!hayRol) return;
    await correr(RLS, "down.sql");
    expect((await foto()).politicas.filter((p) => p.tabla === "CuentaDeCobro").map((p) => p.nombre), "sin la migración de políticas queda solo la de empresa").toEqual(["aislamiento_empresa"]);

    await base.cliente.query(`INSERT INTO "CuentaDeCobro" ("id","empresaId","sucursalId","tipo","nombre") VALUES ('${UUID}10',$1,'suc_a','TERMINAL','Posnet')`, [E]);
    const conCuenta = await foto();
    await expect(correr(TABLA, "down.sql")).rejects.toThrow(/No se puede bajar 20261117130000_caja_c3_cuenta_de_cobro: CuentaDeCobro tiene 1 fila/);
    expect(await foto(), "la reversa abortada no tocó nada").toEqual(conCuenta);
    await base.cliente.query(`DELETE FROM "CuentaDeCobro"`);

    await base.cliente.query(`UPDATE "MedioDePago" SET "pideCupon" = true WHERE "tipo" = 'TARJETA_DEBITO'`);
    await expect(correr(TABLA, "down.sql")).rejects.toThrow(/1 medio\(s\) piden datos/);
    await base.cliente.query(`UPDATE "MedioDePago" SET "pideCupon" = false`);

    await base.cliente.query(`UPDATE "ValorDeLista" SET "activo" = false, "version" = 2 WHERE "nombre" = 'Cabal'`);
    await expect(correr(TABLA, "down.sql")).rejects.toThrow(/la lista de marcas ya no es la sembrada/);
    await base.cliente.query(`UPDATE "ValorDeLista" SET "activo" = true, "version" = 1 WHERE "nombre" = 'Cabal'`);

    // Un cobro con datos (y todo lo que hace falta para que exista).
    await base.cliente.query(`INSERT INTO "User" ("id","email") VALUES ('u_c3','c3@ejemplo.test')`);
    await base.cliente.query(`INSERT INTO "Mesa" ("id","empresaId","sucursalId","numero") VALUES ('mesa_c3',$1,'suc_a',1)`, [E]);
    await base.cliente.query(`INSERT INTO "Cuenta" ("id","empresaId","mesaId","abiertaPorId","cerradaEn","cerradaPorId","comensales") VALUES ('cta_c3',$1,'mesa_c3','u_c3',now(),'u_c3',2)`, [E]);
    await base.cliente.query(`INSERT INTO "Caja" ("id","empresaId","sucursalId","nombre") VALUES ('${UUID}30',$1,'suc_a','Caja 1')`, [E]);
    await base.cliente.query(`INSERT INTO "SesionCaja" ("id","empresaId","sucursalId","cajaId","estado","fechaDeNegocio","zonaHoraria","abiertaPorId","claveIdempotencia","huella") VALUES ('${UUID}31',$1,'suc_a','${UUID}30','ABIERTA','2026-01-15','America/Argentina/Buenos_Aires','u_c3','${UUID}32',$2)`, [E, "a".repeat(64)]);
    await base.cliente.query(`BEGIN`);
    await base.cliente.query(`UPDATE "MedioDePago" SET "pideCupon" = true WHERE "tipo" = 'TARJETA_DEBITO'`);
    await base.cliente.query(`INSERT INTO "Cobranza" ("id","empresaId","sucursalId","cuentaId","sesionId","total","claveIdempotencia","huella","creadoPorId") VALUES ('${UUID}33',$1,'suc_a','cta_c3','${UUID}31',1,'${UUID}34',$2,'u_c3')`, [E, "a".repeat(64)]);
    await base.cliente.query(`INSERT INTO "MovimientoCaja" ("id","empresaId","sucursalId","sesionId","clase","medioDePagoId","importe","creadoPorId") VALUES ('${UUID}35',$1,'suc_a','${UUID}31','COBRO','${UUID}21',1,'u_c3')`, [E]);
    await base.cliente.query(`INSERT INTO "Cobro" ("id","empresaId","sucursalId","cobranzaId","orden","medioDePagoId","movimientoId","importe","cupon") VALUES ('${UUID}36',$1,'suc_a','${UUID}33',1,'${UUID}21','${UUID}35',1,'A1')`, [E]);
    await base.cliente.query(`COMMIT`);
    const conCobro = await foto();
    await expect(correr(TABLA, "down.sql")).rejects.toThrow(/cobro\(s\) con cuenta o datos/);
    expect(await foto(), "la reversa abortada no tocó nada").toEqual(conCobro);
    await base.cliente.query(`DELETE FROM "Cobro"; DELETE FROM "MovimientoCaja"; DELETE FROM "Cobranza"; DELETE FROM "SesionCaja"; DELETE FROM "Caja"; DELETE FROM "Cuenta"; DELETE FROM "Mesa"; DELETE FROM "User"; UPDATE "MedioDePago" SET "pideCupon" = false`);
  });

  it("3. BAJAR SIN DATOS: el catálogo y el código de las funciones quedan IDÉNTICOS a los de C1; las reversas son idempotentes", async () => {
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
