import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";
import { MIGRACION_B1_FUNCIONES, MIGRACIONES_DE_POLITICAS_DE_SUCURSAL, MIGRACIONES_DE_POLITICAS_POSTERIORES, TABLAS_DEL_PAQUETE_1, ULTIMA_MIGRACION_DEL_PAQUETE_1 } from "../setup/migraciones-de-alcance-de-sucursal";
import { COMANDOS_CON_POLITICA_DE_ALCANCE } from "../setup/politicas-de-alcance-de-sucursal";

/**
 * M2 (Paquete 2): SUBIR, BAJAR y SUBIR de las cuatro migraciones reales (M2-1 a M2-4) sobre una base TEMPORAL descartable (`crearBaseTemporalMigrada`: solo Postgres local, jamás `motor2_dev`, `motor2_e2e` ni una base real), con cada
 * `down.sql` tal cual está en el repo. Parte de la base del Paquete 1 ya aplicado (hasta B6, `ULTIMA_MIGRACION_DEL_PAQUETE_1`), que es el estado de producción antes de M2.
 *
 * ATENCIÓN: la reversa de M2-3 (borra la tabla `Venta`) y la de M2-1 y M2-2 (borran columnas con datos) son DESTRUCTIVAS si ya hay datos nuevos; la prueba las corre con datos a propósito, sobre la base temporal, que se borra al terminar.
 *
 * Qué comprueba:
 *  1. ARRIBA (M2-1 a M2-4 aplicadas sobre una base con operaciones previas): las columnas nuevas en NULL en las filas viejas, los CHECK validados, los índices únicos, las claves foráneas, la tabla `Venta`, sus 4 políticas de sucursal
 *     RESTRICTIVE para `motor2_app` (y las 128 del Paquete 1 intactas) y los privilegios EXACTOS (SELECT e INSERT; UPDATE y DELETE dan 42501). Humo como `motor2_app`: sin alcance no se ve nada, una `Venta` de otra sucursal no se ve,
 *     un INSERT en otra sucursal da 42501.
 *  2. ABAJO (M2-4, M2-3, M2-2, M2-1, en ese orden; con datos nuevos escritos): el catálogo queda IDÉNTICO al de antes de M2 (columnas, índices, restricciones, políticas, tipos, RLS y privilegios); las filas que no se borran siguen, y lo que
 *     se pierde es exactamente lo que dicen los down.sql (las columnas nuevas y la tabla `Venta`).
 *  3. ARRIBA OTRA VEZ: las mismas comprobaciones, y el catálogo es idéntico al de la primera subida; las filas viejas siguen con NULL.
 *  4. B1 no se puede bajar mientras M2-4 siga puesta (una política de `Venta` usa las funciones), y bajar M2-4 antes lo permite; las reversas son idempotentes.
 */
const RAIZ = join(__dirname, "../../prisma/migrations");
const M2_1 = "20261015120000_m2_operacion_reversiones_y_motivo";
const M2_2 = "20261015121000_m2_movimiento_devuelve_a";
const M2_3 = "20261015122000_m2_cabecera_de_venta";
const M2_4 = "20261015123000_m2_rls_sucursal_venta";
const SUBIDA = [M2_1, M2_2, M2_3, M2_4];
/** La reversa va en orden inverso: M2-4 ANTES que M2-3 (y que B1), y M2-1 al final. */
const BAJADA = [M2_4, M2_3, M2_2, M2_1];

const CHECKS_NUEVOS = [
  "Operacion_revierte_solo_ajuste_chk", "Operacion_motivo_anulacion_chk", "Operacion_merma_por_anulacion_solo_merma_chk", "Operacion_reemplaza_solo_venta_chk", "ConteoFisico_motivo_cancelacion_chk",
  "MovimientoStock_devuelve_solo_devolucion_proveedor_chk", "Venta_canal_y_cuenta_chk", "Venta_importe_total_no_negativo_chk", "Operacion_venta_solo_en_ventas_chk",
];
const UNICOS_NUEVOS = [
  "Operacion_empresaId_revierteAOperacionId_key", "Operacion_empresaId_mermaPorAnulacionDeId_key", "Operacion_empresaId_reemplazaAOperacionId_key", "Venta_empresaId_id_key", "Venta_empresaId_cuentaId_key",
];
const CLAVES_FORANEAS_NUEVAS = [
  "Operacion_empresaId_revierteAOperacionId_fkey", "Operacion_empresaId_mermaPorAnulacionDeId_fkey", "Operacion_empresaId_reemplazaAOperacionId_fkey", "MovimientoStock_empresaId_devuelveAMovimientoId_fkey",
  "Operacion_empresaId_ventaId_fkey", "Venta_empresaId_fkey", "Venta_empresaId_sucursalId_fkey", "Venta_empresaId_cuentaId_fkey", "Venta_usuarioId_fkey",
];
const COLUMNAS_NUEVAS = [
  "Operacion.revierteAOperacionId", "Operacion.motivoAnulacion", "Operacion.mermaPorAnulacionDeId", "Operacion.reemplazaAOperacionId", "Operacion.ventaId", "ConteoFisico.motivoCancelacion", "MovimientoStock.devuelveAMovimientoId",
];

const E = "empresa_m2";
const sql = (migracion: string, archivo: "migration.sql" | "down.sql") => readFileSync(join(RAIZ, migracion, archivo), "utf8");
let base: BaseTemporalMigrada;
let hayRol = false;
let app: Client | null = null;

/** Una sola consulta con todo el archivo (protocolo simple de `pg`: una transacción implícita, como `psql -1`). */
const correr = (migracion: string, archivo: "migration.sql" | "down.sql") => base.cliente.query(sql(migracion, archivo));
const q = <T extends object = Record<string, unknown>>(texto: string, params: unknown[] = []) => base.cliente.query<T>(texto, params).then((r) => r.rows);

/** Una foto del catálogo de `public` que cubre todo lo que M2 toca: se compara antes de M2, después de bajar todo y después de subir otra vez. */
async function foto() {
  return {
    politicas: await q(`SELECT tablename::text AS tabla, policyname::text AS nombre, permissive, roles::text AS roles, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public' ORDER BY 1, 2`),
    columnas: await q(`SELECT table_name::text AS tabla, column_name::text AS columna, data_type, udt_name::text AS udt, is_nullable, column_default, numeric_precision, numeric_scale FROM information_schema.columns WHERE table_schema = 'public' ORDER BY 1, ordinal_position`),
    indices: await q(`SELECT tablename::text AS tabla, indexname::text AS nombre, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY 1, 2`),
    restricciones: await q(`SELECT conrelid::regclass::text AS tabla, conname::text AS nombre, contype, convalidated, pg_get_constraintdef(oid) AS definicion FROM pg_constraint WHERE connamespace = 'public'::regnamespace ORDER BY 1, 2`),
    rls: await q(`SELECT relname::text AS tabla, relrowsecurity AS rls, relforcerowsecurity AS forzado FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' ORDER BY 1`),
    privilegios: await q(`SELECT table_name::text AS tabla, grantee::text AS rol, privilege_type FROM information_schema.role_table_grants WHERE table_schema = 'public' AND grantee IN ('motor2_app', 'motor2_plataforma') ORDER BY 1, 2, 3`),
    tipos: await q(`SELECT t.typname::text AS tipo, array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS valores FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid WHERE t.typnamespace = 'public'::regnamespace GROUP BY 1 ORDER BY 1`),
    funciones: await q(`SELECT p.proname::text AS nombre, pg_get_functiondef(p.oid) AS definicion FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace ORDER BY 1`),
  };
}

/** Una conexión como `motor2_app` (el rol de la app, sujeto a la RLS) a la base temporal. */
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

/** El SQLSTATE con el que falla una sentencia (dentro de un SAVEPOINT para no abortar la transacción), o `null` si anduvo. */
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

/** Una cabecera de mostrador. Como `motor2_app` la empresa sale del contexto (default); como dueño, que no tiene contexto, se indica. */
const insertarVenta = (id: string, sucursalId: string, empresa?: string) =>
  `INSERT INTO "Venta" (${empresa ? '"empresaId",' : ""}"id","sucursalId","canal","fecha","importeTotal","usuarioId") VALUES (${empresa ? `'${empresa}',` : ""}'${id}','${sucursalId}','MOSTRADOR',now(),'10.00','u_m2')`;

/** Las comprobaciones de «todo aplicado». */
async function comprobarArriba(etiqueta: string) {
  const f = await foto();
  const conNombre = (lista: Array<Record<string, unknown>>, campo: string) => lista.map((x) => String(x[campo]));

  for (const c of COLUMNAS_NUEVAS) {
    const [tabla, columna] = c.split(".") as [string, string];
    const fila = f.columnas.find((x) => x.tabla === tabla && x.columna === columna);
    expect(fila, `${etiqueta}: existe la columna ${c}`).toBeDefined();
    expect(fila!.is_nullable, `${etiqueta}: ${c} es NULLABLE`).toBe("YES");
    expect(fila!.column_default, `${etiqueta}: ${c} sin valor por defecto`).toBeNull();
  }
  for (const nombre of CHECKS_NUEVOS) {
    const r = f.restricciones.find((x) => x.nombre === nombre);
    expect(r, `${etiqueta}: existe el CHECK ${nombre}`).toBeDefined();
    expect([r!.contype, r!.convalidated], `${etiqueta}: ${nombre} es un CHECK validado`).toEqual(["c", true]);
  }
  for (const nombre of CLAVES_FORANEAS_NUEVAS) expect(conNombre(f.restricciones, "nombre"), `${etiqueta}: existe la clave foránea ${nombre}`).toContain(nombre);
  for (const nombre of UNICOS_NUEVOS) {
    const i = f.indices.find((x) => x.nombre === nombre);
    expect(i, `${etiqueta}: existe el índice único ${nombre}`).toBeDefined();
    expect(String(i!.indexdef), `${etiqueta}: ${nombre}`).toMatch(/^CREATE UNIQUE INDEX/);
  }
  expect(f.tipos.find((t) => t.tipo === "CanalDeVenta")?.valores, `${etiqueta}: el tipo del canal`).toEqual(["MESA", "MOSTRADOR"]);

  // Políticas: las 4 de sucursal de Venta (RESTRICTIVE, solo motor2_app, uno por comando) y las 128 del Paquete 1 intactas; más la de empresa.
  const deAlcance = f.politicas.filter((p) => String(p.nombre).startsWith("alcance_sucursal_"));
  const deVenta = deAlcance.filter((p) => p.tabla === "Venta");
  expect(deVenta.map((p) => p.cmd).sort(), `${etiqueta}: 4 políticas de sucursal en Venta`).toEqual(["DELETE", "INSERT", "SELECT", "UPDATE"]);
  for (const p of deVenta) expect([p.permissive, p.roles], `${etiqueta}: ${p.nombre} RESTRICTIVE para motor2_app`).toEqual(["RESTRICTIVE", "{motor2_app}"]);
  expect(deAlcance, `${etiqueta}: 128 del Paquete 1 + 4 de Venta`).toHaveLength(TABLAS_DEL_PAQUETE_1.length * COMANDOS_CON_POLITICA_DE_ALCANCE.length + 4);
  expect(f.politicas.filter((p) => p.tabla === "Venta" && p.nombre === "aislamiento_empresa"), `${etiqueta}: la política de empresa de Venta`).toHaveLength(1);
  expect(f.rls.find((r) => r.tabla === "Venta"), `${etiqueta}: Venta con RLS`).toEqual({ tabla: "Venta", rls: true, forzado: false });

  // Privilegios exactos: SELECT e INSERT para motor2_app; nada para motor2_plataforma.
  const privilegios = f.privilegios.filter((p) => p.tabla === "Venta");
  expect(privilegios, `${etiqueta}: solo se agrega`).toEqual([{ tabla: "Venta", rol: "motor2_app", privilege_type: "INSERT" }, { tabla: "Venta", rol: "motor2_app", privilege_type: "SELECT" }]);

  // Las filas viejas siguen y las columnas nuevas quedaron en NULL.
  const viejas = await q<{ id: string; nulos: boolean }>(
    `SELECT id, ("revierteAOperacionId" IS NULL AND "motivoAnulacion" IS NULL AND "mermaPorAnulacionDeId" IS NULL AND "reemplazaAOperacionId" IS NULL AND "ventaId" IS NULL) AS nulos FROM "Operacion" WHERE id IN ('op_vieja', 'aj_manual') ORDER BY id`,
  );
  expect(viejas, `${etiqueta}: las operaciones previas a M2 siguen, con NULL en lo nuevo`).toEqual([{ id: "aj_manual", nulos: true }, { id: "op_vieja", nulos: true }]);

  // Humo como el rol real de la app.
  app ??= await conectarComoApp();
  const comoApp = async (alcance: { lectura?: string; escritura?: string }, fn: (c: Client) => Promise<void>) => {
    await app!.query("BEGIN");
    try {
      await app!.query("SELECT set_config('app.empresa_id', $1, true)", [E]);
      if (alcance.lectura !== undefined) await app!.query("SELECT set_config('app.sucursales_lectura', $1, true)", [alcance.lectura]);
      if (alcance.escritura !== undefined) await app!.query("SELECT set_config('app.sucursales_escritura', $1, true)", [alcance.escritura]);
      await fn(app!);
    } finally {
      await app!.query("ROLLBACK");
    }
  };
  // Una cabecera de OTRA sucursal, escrita por el dueño y confirmada: tiene que ser invisible desde la sucursal A.
  await base.cliente.query(`DELETE FROM "Venta" WHERE id IN ('venta_a', 'venta_b')`);
  await base.cliente.query(insertarVenta("venta_a", "suc_a", E));
  await base.cliente.query(insertarVenta("venta_b", "suc_b", E));
  await comoApp({}, async (c) => {
    expect((await c.query(`SELECT id FROM "Venta"`)).rows, `${etiqueta}: sin alcance no se ve ninguna cabecera (falla cerrado)`).toEqual([]);
  });
  await comoApp({ lectura: "suc_a", escritura: "suc_a" }, async (c) => {
    expect((await c.query(`SELECT id FROM "Venta" ORDER BY id`)).rows, `${etiqueta}: con la sucursal A solo se ve la de A, no la de B`).toEqual([{ id: "venta_a" }]);
    expect(await falla(c, insertarVenta("venta_nueva", "suc_a")), `${etiqueta}: insertar en la sucursal del alcance anda`).toBeNull();
    expect(await falla(c, insertarVenta("venta_ajena", "suc_b")), `${etiqueta}: insertar en otra sucursal da 42501`).toBe("42501");
    expect(await falla(c, `UPDATE "Venta" SET "importeTotal" = '0.01' WHERE id = 'venta_a'`), `${etiqueta}: UPDATE da 42501 (solo se agrega)`).toBe("42501");
    expect(await falla(c, `DELETE FROM "Venta" WHERE id = 'venta_a'`), `${etiqueta}: DELETE da 42501 (solo se agrega)`).toBe("42501");
  });
  await comoApp({ lectura: "suc_b", escritura: "" }, async (c) => {
    expect((await c.query(`SELECT id FROM "Venta" ORDER BY id`)).rows, `${etiqueta}: con solo lectura de la sucursal B se ve la de B y no la de A`).toEqual([{ id: "venta_b" }]);
    expect(await falla(c, insertarVenta("venta_sin_escritura", "suc_b")), `${etiqueta}: con solo lectura no se puede insertar (42501)`).toBe("42501");
  });
}

let antesDeM2: Awaited<ReturnType<typeof foto>>;
let arribaLaPrimeraVez: Awaited<ReturnType<typeof foto>>;

beforeAll(async () => {
  base = await crearBaseTemporalMigrada();
  hayRol = (await base.cliente.query("SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app'")).rowCount === 1;
  if (!hayRol) return; // sin el rol, `CREATE POLICY … TO motor2_app` falla: el archivo omite sus casos con motivo (como los demás tests de RLS).
  await base.aplicarHasta(ULTIMA_MIGRACION_DEL_PAQUETE_1);
  await base.cliente.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO motor2_app`);
  // Datos que existen ANTES de M2 y que ninguna reversa borra (una empresa con dos sucursales, un usuario y dos operaciones: una venta y un ajuste manual).
  const c = base.cliente;
  await c.query(`INSERT INTO "Empresa" ("id","nombre","slug","zonaHoraria","moneda","estado") VALUES ($1,$1,$1,'America/Argentina/Buenos_Aires','ARS','ACTIVE')`, [E]);
  await c.query(`INSERT INTO "Sucursal" ("id","empresaId","nombre") VALUES ('suc_a',$1,'Centro'), ('suc_b',$1,'Norte')`, [E]);
  await c.query(`INSERT INTO "User" ("id","email") VALUES ('u_m2','m2@ejemplo.test')`);
  await c.query(
    `INSERT INTO "Operacion" ("id","empresaId","sucursalId","proceso","fecha","usuarioId") VALUES ('op_vieja',$1,'suc_a','VENTA',now(),'u_m2'), ('aj_manual',$1,'suc_a','AJUSTE',now(),'u_m2')`,
    [E],
  );
  antesDeM2 = await foto();
}, 120_000);

afterAll(async () => {
  await app?.end().catch(() => undefined);
  await base?.eliminar();
});

describe("M2: subir, bajar y subir (M2-1 a M2-4) sobre una base temporal con el Paquete 1 aplicado", () => {
  it("0. las cuatro migraciones existen, son posteriores al Paquete 1, van en este orden y la última está declarada como política posterior", () => {
    expect([...SUBIDA].sort()).toEqual(SUBIDA);
    for (const m of SUBIDA) {
      expect(m > ULTIMA_MIGRACION_DEL_PAQUETE_1, `${m} es posterior a B6`).toBe(true);
      expect(sql(m, "migration.sql").split("\n")[0], `${m}: avisa que requiere autorización`).toContain("REQUIERE AUTORIZACIÓN EXPRESA");
      expect(sql(m, "down.sql").length, `${m}: tiene down.sql`).toBeGreaterThan(0);
    }
    expect(MIGRACIONES_DE_POLITICAS_POSTERIORES.map((g) => g.migracion)).toContain(M2_4);
    expect(MIGRACIONES_DE_POLITICAS_DE_SUCURSAL.map((g) => g.migracion)).not.toContain(M2_4);
  });

  it("1. SUBIR: M2-1 a M2-4 sobre una base con operaciones previas dejan todo arriba (columnas, reglas, tabla, 4 políticas de sucursal, privilegios exactos) y andan como motor2_app", async (ctx) => {
    if (!hayRol) return ctx.skip();
    for (const m of SUBIDA) await correr(m, "migration.sql");
    await comprobarArriba("primera subida");
    arribaLaPrimeraVez = await foto();
    expect(arribaLaPrimeraVez.columnas.length, "sanidad de la foto").toBeGreaterThan(antesDeM2.columnas.length + 6);
  });

  it("2. BAJAR: B1 no se puede bajar mientras M2-4 siga puesta (una política de Venta usa las funciones); sin M2-4 y sin las del Paquete 1 sí", async (ctx) => {
    if (!hayRol) return ctx.skip();
    // Se bajan B6 … B2: queda B1 con las políticas de Venta (M2-4) como ÚNICAS que usan las funciones.
    for (const g of [...MIGRACIONES_DE_POLITICAS_DE_SUCURSAL].reverse()) await correr(g.migracion, "down.sql");
    const usadas = await q<{ tabla: string }>(`SELECT DISTINCT tablename::text AS tabla FROM pg_policies WHERE schemaname = 'public' AND policyname LIKE 'alcance\\_sucursal\\_%'`);
    expect(usadas, "solo quedan las políticas de Venta").toEqual([{ tabla: "Venta" }]);
    await expect(correr(MIGRACION_B1_FUNCIONES, "down.sql")).rejects.toThrow(/depend/i);
    expect((await q<{ nombre: string }>(`SELECT proname::text AS nombre FROM pg_proc WHERE proname LIKE 'app\\_sucursales\\_%' ORDER BY 1`)).map((f) => f.nombre), "la reversa fallida no dejó nada a medias").toEqual(["app_sucursales_escritura", "app_sucursales_lectura"]);
    // Bajando M2-4 primero, B1 baja.
    await correr(M2_4, "down.sql");
    await correr(MIGRACION_B1_FUNCIONES, "down.sql");
    expect(await q(`SELECT proname FROM pg_proc WHERE proname LIKE 'app\\_sucursales\\_%'`), "0 funciones").toEqual([]);
    // Se vuelve al estado de «todo arriba» para el resto del archivo.
    await correr(MIGRACION_B1_FUNCIONES, "migration.sql");
    for (const g of MIGRACIONES_DE_POLITICAS_DE_SUCURSAL) await correr(g.migracion, "migration.sql");
    await correr(M2_4, "migration.sql");
    await comprobarArriba("después del intento de bajar B1");
  });

  it("3. BAJAR (con datos nuevos escritos): M2-4, M2-3, M2-2 y M2-1 en orden inverso dejan el catálogo como estaba antes de M2; las filas previas siguen y se pierde justo lo que dicen los down.sql", async (ctx) => {
    if (!hayRol) return ctx.skip();
    // Datos que solo existen por M2 (escritos por el dueño): una venta anulada con motivo, su reversión enlazada, una cabecera con una línea y una merma por anulación.
    await base.cliente.query(`UPDATE "Operacion" SET "anuladaEn" = now(), "anuladaPorId" = 'u_m2', "motivoAnulacion" = 'Se equivocó el mozo' WHERE id = 'op_vieja'`);
    await base.cliente.query(`INSERT INTO "Operacion" ("id","empresaId","sucursalId","proceso","fecha","usuarioId","revierteAOperacionId") VALUES ('aj_reversion',$1,'suc_a','AJUSTE',now(),'u_m2','op_vieja')`, [E]);
    await base.cliente.query(`INSERT INTO "Operacion" ("id","empresaId","sucursalId","proceso","fecha","usuarioId","mermaPorAnulacionDeId") VALUES ('merma_anulacion',$1,'suc_a','MERMA',now(),'u_m2','op_vieja')`, [E]);
    await base.cliente.query(`UPDATE "Operacion" SET "ventaId" = 'venta_a' WHERE id = 'op_vieja'`);
    expect(Number((await q<{ n: string }>(`SELECT count(*) AS n FROM "Venta"`))[0]!.n), "hay cabeceras que la reversa va a perder").toBeGreaterThan(0);

    for (const m of BAJADA) await correr(m, "down.sql");
    const despues = await foto();
    for (const k of Object.keys(antesDeM2) as (keyof typeof antesDeM2)[]) expect(despues[k], `catálogo «${k}» igual que antes de M2`).toEqual(antesDeM2[k]);
    expect(await q(`SELECT 1 FROM pg_class WHERE relname = 'Venta' AND relnamespace = 'public'::regnamespace`), "sin la tabla Venta").toEqual([]);
    expect(await q(`SELECT 1 FROM pg_type WHERE typname = 'CanalDeVenta'`), "sin el tipo CanalDeVenta").toEqual([]);
    expect((await q<{ id: string }>(`SELECT id FROM "Operacion" ORDER BY id`)).map((o) => o.id), "las operaciones (incluso las escritas con M2) siguen: la reversa borra columnas, no filas").toEqual(["aj_manual", "aj_reversion", "merma_anulacion", "op_vieja"]);
    expect((await q<{ anulada: boolean }>(`SELECT "anuladaEn" IS NOT NULL AS anulada FROM "Operacion" WHERE id = 'op_vieja'`))[0]!.anulada, "la anulación misma sigue (solo se pierde su motivo)").toBe(true);
  });

  it("4. SUBIR OTRA VEZ: las mismas comprobaciones, el catálogo es idéntico al de la primera subida y lo que se perdió al bajar (cabeceras, enlaces, motivos) quedó en NULL o vacío", async (ctx) => {
    if (!hayRol) return ctx.skip();
    for (const m of SUBIDA) await correr(m, "migration.sql");
    expect(Number((await q<{ n: string }>(`SELECT count(*) AS n FROM "Venta"`))[0]!.n), "la tabla volvió vacía: las cabeceras de antes no se recuperan").toBe(0);
    const perdido = await q<{ id: string; anulada: boolean; revierte: string | null; motivo: string | null; venta: string | null; merma: string | null }>(
      `SELECT id, "anuladaEn" IS NOT NULL AS anulada, "revierteAOperacionId" AS revierte, "motivoAnulacion" AS motivo, "ventaId" AS venta, "mermaPorAnulacionDeId" AS merma FROM "Operacion" WHERE id IN ('op_vieja', 'aj_reversion', 'merma_anulacion') ORDER BY id`,
    );
    expect(perdido, "las filas siguen; los enlaces y el motivo no").toEqual([
      { id: "aj_reversion", anulada: false, revierte: null, motivo: null, venta: null, merma: null },
      { id: "merma_anulacion", anulada: false, revierte: null, motivo: null, venta: null, merma: null },
      { id: "op_vieja", anulada: true, revierte: null, motivo: null, venta: null, merma: null },
    ]);
    await comprobarArriba("segunda subida");
    const otraVez = await foto();
    for (const k of Object.keys(arribaLaPrimeraVez) as (keyof typeof arribaLaPrimeraVez)[]) expect(otraVez[k], `catálogo «${k}» igual que la primera vez`).toEqual(arribaLaPrimeraVez[k]);
  });

  it("5. Las reversas son idempotentes (IF EXISTS): bajar dos veces no falla, y volver a subir deja todo arriba", async (ctx) => {
    if (!hayRol) return ctx.skip();
    for (const m of BAJADA) {
      await correr(m, "down.sql");
      await correr(m, "down.sql");
    }
    const despues = await foto();
    for (const k of Object.keys(antesDeM2) as (keyof typeof antesDeM2)[]) expect(despues[k], `catálogo «${k}» igual que antes de M2`).toEqual(antesDeM2[k]);
    for (const m of SUBIDA) await correr(m, "migration.sql");
    await comprobarArriba("tercera subida");
  });
});
