import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";
import { RESERVADAS_EN_BASE } from "../setup/claves-reservadas-en-base";
import { MIGRACIONES_DE_POLITICAS_DE_SUCURSAL, MIGRACIONES_DE_POLITICAS_POSTERIORES, TABLAS_DEL_PAQUETE_1 } from "../setup/migraciones-de-alcance-de-sucursal";
import { COMANDOS_CON_POLITICA_DE_ALCANCE } from "../setup/politicas-de-alcance-de-sucursal";

/**
 * Paquete 3, M4 (los GASTOS: M4.1 a M4.5): SUBIR, BAJAR y SUBIR de las migraciones reales sobre una base TEMPORAL descartable (`crearBaseTemporalMigrada`: solo Postgres local, jamás `motor2_dev`, `motor2_e2e` ni una base real), con cada `down.sql`
 * tal cual está en el repo. Parte de la base con el Paquete 2 ya aplicado (hasta `20261015123000_m2_rls_sucursal_venta`) y con M3 subido (M3a a M3e), que es el estado de producción antes de M4.
 *
 * ATENCIÓN: la reversa de M4.1 (borra el catálogo de conceptos), la de M4.3 (borra las imputaciones) y la de M4.5 (borra las siete claves y lo configurado sobre ellas) son DESTRUCTIVAS si ya hay datos nuevos; la de M4.2 ABORTA si ya hay renglones sin stock.
 * La prueba las corre con datos a propósito, sobre la base temporal, que se borra al terminar.
 *
 * Qué comprueba:
 *  1. ARRIBA (M4.1 a M4.5 sobre una base con M3 y datos previos): las tres cosas nuevas (conceptos, renglón sin stock e imputación) con sus reglas, índices, claves foráneas (la del discriminador), RLS y privilegios EXACTOS, los dos CHECK de M3 reemplazados,
 *     las cuatro políticas de sucursal de la imputación y las siete claves de permiso sembradas; y un humo como `motor2_app`.
 *  2. ABAJO (M4.5, M4.4, M4.3, M4.2, M4.1, en ese orden; con datos nuevos escritos): la reversa de M4.2 ABORTA mientras haya un renglón sin stock; sin él, el catálogo queda IDÉNTICO al de antes de M4 (columnas, índices, restricciones —incluidos los dos CHECK de M3 con su
 *     definición exacta—, políticas, RLS, privilegios, disparadores y funciones) y las filas que no se borran siguen.
 *  3. ARRIBA OTRA VEZ: las mismas comprobaciones, y el catálogo es idéntico al de la primera subida.
 *  4. EL CICLO COMPLETO DE M3 MÁS M4: se baja todo (M4.5 a M4.1 y después M3e a M3a) hasta el estado del Paquete 2, el catálogo es idéntico al de entonces, y se sube todo otra vez (M3 y M4) hasta el mismo catálogo de antes.
 *  5. Las reversas son idempotentes (IF EXISTS) y la de M4.4 no toca las políticas del Paquete 1, ni las de Venta ni las de la parte de la factura.
 *  6. PAQUETE 4, M5 (`ReclasificacionRenglon`, una migración, sobre el estado que dejan los casos de M4 con todo arriba): SUBIR (tabla, claves foráneas, CHECK, una política, privilegios exactos y un humo como `motor2_app`); BAJAR CON DATOS (la reversa ABORTA
 *     mientras haya reclasificaciones; con M5 arriba las reversas de M4.2 y M4.1 FALLAN por dependencia, sin dejar nada a medias; sin filas la de M5 pasa y el catálogo queda idéntico al de antes de M5); SUBIR OTRA VEZ (catálogo idéntico al de la primera subida);
 *     el CICLO COMPLETO (M5, M4.5 a M4.1 y M3 hasta el Paquete 2, y de vuelta hasta M5 arriba); y la reversa de M5 idempotente. Los casos 0 a 5 de M4 no cambian.
 */
const RAIZ = join(__dirname, "../../prisma/migrations");
const ULTIMA_DEL_PAQUETE_2 = "20261015123000_m2_rls_sucursal_venta";
const M3 = [
  "20261016100000_permiso_compra_repartir", "20261016101000_factura_proveedor", "20261016101500_factura_proveedor_recepcion", "20261016102000_rls_sucursal_factura_proveedor_sucursal",
  "20261016103000_factura_proveedor_iva", "20261016104000_proveedor_condicion_iva_y_puntos_de_venta",
];
const M4_1 = "20261016110000_concepto_de_gasto";
const M4_2 = "20261016111000_renglon_sin_stock";
const M4_3 = "20261016112000_imputacion_de_gasto";
const M4_4 = "20261016113000_rls_sucursal_imputacion_de_gasto";
const M4_5 = "20261016114000_permisos_gastos";
const SUBIDA = [M4_1, M4_2, M4_3, M4_4, M4_5];
/** La reversa va en orden inverso: las claves, las políticas, la imputación, el renglón y el catálogo. */
const BAJADA = [M4_5, M4_4, M4_3, M4_2, M4_1];

const CHECKS_NUEVOS = [
  "ConceptoDeGasto_codigo_chk", "ConceptoDeGasto_nombre_chk", "ConceptoDeGasto_tipo_de_costo_chk", "FacturaProveedorRenglon_tipo_de_costo_chk", "FacturaProveedorRenglon_pareo_naturaleza_chk",
  "ImputacionDeGasto_naturaleza_chk", "ImputacionDeGasto_importe_positivo_chk", "ImputacionDeGasto_iva_computable_chk",
];
const UNICOS_NUEVOS = [
  "ConceptoDeGasto_empresaId_id_key", "ConceptoDeGasto_empresaId_codigo_key", "ConceptoDeGasto_empresaId_nombre_key", "ConceptoDeGasto_nombre_lower_key", "FacturaProveedorRenglon_empresaId_id_naturaleza_key",
  "ImputacionDeGasto_empresaId_id_key", "ImputacionDeGasto_facturaProveedorRenglonId_sucursalId_key",
];
const CLAVES_FORANEAS_NUEVAS = [
  "ConceptoDeGasto_empresaId_fkey", "FacturaProveedorRenglon_empresaId_conceptoGastoId_fkey", "ImputacionDeGasto_empresaId_fkey", "ImputacionDeGasto_empresaId_facturaProveedorRenglonId_natu_fkey", "ImputacionDeGasto_empresaId_sucursalId_fkey",
];
const TABLAS_NUEVAS = ["ConceptoDeGasto", "ImputacionDeGasto"];
const CLAVES = Object.keys(RESERVADAS_EN_BASE).sort();

const E = "empresa_m4";
const sql = (migracion: string, archivo: "migration.sql" | "down.sql") => readFileSync(join(RAIZ, migracion, archivo), "utf8");
let base: BaseTemporalMigrada;
let hayRol = false;
let app: Client | null = null;

/** Una sola consulta con todo el archivo (protocolo simple de `pg`: una transacción implícita, como `psql -1`). */
const correr = (migracion: string, archivo: "migration.sql" | "down.sql") => base.cliente.query(sql(migracion, archivo));
const q = <T extends object = Record<string, unknown>>(texto: string, params: unknown[] = []) => base.cliente.query<T>(texto, params).then((r) => r.rows);

/** Una foto del catálogo de `public` que cubre todo lo que M3 y M4 tocan: se compara antes de M3, antes de M4, después de bajar y después de subir otra vez. */
async function foto() {
  return {
    politicas: await q(`SELECT tablename::text AS tabla, policyname::text AS nombre, permissive, roles::text AS roles, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public' ORDER BY 1, 2`),
    columnas: await q(`SELECT table_name::text AS tabla, column_name::text AS columna, data_type, udt_name::text AS udt, is_nullable, column_default, numeric_precision, numeric_scale FROM information_schema.columns WHERE table_schema = 'public' ORDER BY 1, ordinal_position`),
    indices: await q(`SELECT tablename::text AS tabla, indexname::text AS nombre, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY 1, 2`),
    restricciones: await q(`SELECT conrelid::regclass::text AS tabla, conname::text AS nombre, contype, convalidated, pg_get_constraintdef(oid) AS definicion FROM pg_constraint WHERE connamespace = 'public'::regnamespace ORDER BY 1, 2`),
    rls: await q(`SELECT relname::text AS tabla, relrowsecurity AS rls, relforcerowsecurity AS forzado FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' ORDER BY 1`),
    privilegios: await q(`SELECT table_name::text AS tabla, grantee::text AS rol, privilege_type FROM information_schema.role_table_grants WHERE table_schema = 'public' AND grantee IN ('motor2_app', 'motor2_plataforma') ORDER BY 1, 2, 3`),
    tipos: await q(`SELECT t.typname::text AS tipo, array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS valores FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid WHERE t.typnamespace = 'public'::regnamespace GROUP BY 1 ORDER BY 1`),
    disparadores: await q(`SELECT tgrelid::regclass::text AS tabla, tgname::text AS nombre, tgenabled::text AS habilitado, pg_get_triggerdef(oid) AS definicion FROM pg_trigger WHERE NOT tgisinternal ORDER BY 1, 2`),
    privilegiosDeColumna: await q(`SELECT table_name::text AS tabla, column_name::text AS columna, grantee::text AS rol, privilege_type FROM information_schema.column_privileges WHERE table_schema = 'public' AND grantee IN ('motor2_app', 'motor2_plataforma') AND (table_name LIKE 'FacturaProveedor%' OR table_name IN ('PuntoDeVentaDeProveedor', 'ConceptoDeGasto', 'ImputacionDeGasto', 'ReclasificacionRenglon')) ORDER BY 1, 2, 3, 4`),
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

const insertarFactura = (id: string, empresa?: string) =>
  `INSERT INTO "FacturaProveedor" (${empresa ? '"empresaId",' : ""}"id","proveedorId","fecha","importeTotal","estado","confirmadaEn","confirmadaPorId","creadoPorId") VALUES (${empresa ? `'${empresa}',` : ""}'${id}','prov_m4','2026-09-01T15:00:00Z','300.00','CONFIRMADA',now(),'u_m4','u_m4')`;
const insertarConcepto = (id: string, codigo: string, empresa?: string) =>
  `INSERT INTO "ConceptoDeGasto" (${empresa ? '"empresaId",' : ""}"id","codigo","nombre","tipoDeCostoPorDefecto") VALUES (${empresa ? `'${empresa}',` : ""}'${id}','${codigo}','Concepto ${codigo}','GASTO_OPERATIVO')`;
const insertarRenglonSinStock = (id: string, factura: string, concepto: string, orden: number, empresa?: string) =>
  `INSERT INTO "FacturaProveedorRenglon" (${empresa ? '"empresaId",' : ""}"id","facturaProveedorId","orden","naturaleza","conceptoGastoId","tipoDeCosto","precioTotal") VALUES (${empresa ? `'${empresa}',` : ""}'${id}','${factura}',${orden},'SIN_STOCK','${concepto}','GASTO_OPERATIVO',200.00)`;
const insertarImputacion = (id: string, renglon: string, sucursal: string, empresa?: string, importe = "100.00") =>
  `INSERT INTO "ImputacionDeGasto" (${empresa ? '"empresaId",' : ""}"id","facturaProveedorRenglonId","sucursalId","importe") VALUES (${empresa ? `'${empresa}',` : ""}'${id}','${renglon}','${sucursal}',${importe})`;

/** Las comprobaciones de «todo aplicado». */
async function comprobarArriba(etiqueta: string) {
  const f = await foto();
  const conNombre = (lista: Array<Record<string, unknown>>, campo: string) => lista.map((x) => String(x[campo]));

  // M4.5: las siete claves, el admin con seis, nadie con gasto_repartir.
  expect((await q<{ clave: string }>(`SELECT "clave" FROM "Accion" WHERE "clave" = ANY($1) ORDER BY 1`, [CLAVES])).map((a) => a.clave), `${etiqueta}: las siete claves existen`).toEqual(CLAVES);
  expect(await q(`SELECT DISTINCT "rolId" FROM "PermisoRol" WHERE "accionClave" = ANY($1) ORDER BY 1`, [CLAVES]), `${etiqueta}: solo el admin tiene alguna`).toEqual([{ rolId: "rol_admin_m4" }]);
  expect(Number((await q<{ n: string }>(`SELECT count(*) AS n FROM "PermisoRol" WHERE "accionClave" = ANY($1)`, [CLAVES]))[0]!.n), `${etiqueta}: seis filas del admin`).toBe(6);
  expect(await q(`SELECT 1 FROM "PermisoRol" WHERE "accionClave" = 'gasto_repartir'`), `${etiqueta}: nadie tiene gasto_repartir`).toEqual([]);

  // M4.1 a M4.3: tablas, reglas, índices, claves foráneas.
  for (const t of TABLAS_NUEVAS) expect(f.rls.find((r) => r.tabla === t), `${etiqueta}: ${t} con RLS`).toEqual({ tabla: t, rls: true, forzado: false });
  for (const nombre of CHECKS_NUEVOS) {
    const r = f.restricciones.find((x) => x.nombre === nombre);
    expect(r, `${etiqueta}: existe el CHECK ${nombre}`).toBeDefined();
    expect([r!.contype, r!.convalidated], `${etiqueta}: ${nombre} es un CHECK validado`).toEqual(["c", true]);
  }
  expect(f.restricciones.find((x) => x.nombre === "FacturaProveedorRenglon_pareo_mercaderia_chk"), `${etiqueta}: el pareo de M3 ya no existe (lo reemplaza el de las dos naturalezas)`).toBeUndefined();
  expect(String(f.restricciones.find((x) => x.nombre === "FacturaProveedorRenglon_naturaleza_chk")!.definicion), `${etiqueta}: la naturaleza admite SIN_STOCK`).toMatch(/MERCADERIA.*SIN_STOCK/);
  for (const nombre of CLAVES_FORANEAS_NUEVAS) expect(conNombre(f.restricciones, "nombre"), `${etiqueta}: existe la clave foránea ${nombre}`).toContain(nombre);
  expect(String(f.restricciones.find((x) => x.nombre === "ImputacionDeGasto_empresaId_facturaProveedorRenglonId_natu_fkey")!.definicion), `${etiqueta}: la clave foránea lleva el discriminador`).toMatch(/\("empresaId", "facturaProveedorRenglonId", "naturalezaRenglon"\) REFERENCES "FacturaProveedorRenglon"\("empresaId", id, naturaleza\)/);
  for (const nombre of UNICOS_NUEVOS) {
    const i = f.indices.find((x) => x.nombre === nombre);
    expect(i, `${etiqueta}: existe el índice único ${nombre}`).toBeDefined();
    expect(String(i!.indexdef), `${etiqueta}: ${nombre}`).toMatch(/^CREATE UNIQUE INDEX/);
  }
  expect(f.columnas.filter((x) => x.tabla === "FacturaProveedorRenglon").slice(-2).map((c) => `${c.columna}:${c.is_nullable}`), `${etiqueta}: las dos columnas nuevas del renglón`).toEqual(["conceptoGastoId:YES", "tipoDeCosto:YES"]);

  // Privilegios exactos: ConceptoDeGasto SELECT e INSERT + UPDATE por columna (nombre, tipo, activo); ImputacionDeGasto solo SELECT e INSERT; nada para motor2_plataforma.
  for (const t of TABLAS_NUEVAS) expect(f.privilegios.filter((p) => p.tabla === t), `${etiqueta}: ${t}: solo se agrega`).toEqual([{ tabla: t, rol: "motor2_app", privilege_type: "INSERT" }, { tabla: t, rol: "motor2_app", privilege_type: "SELECT" }]);
  const actualizables = (tabla: string) =>
    q<{ columna: string }>(`SELECT a.attname::text AS columna FROM pg_attribute a WHERE a.attrelid = '"${tabla}"'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('motor2_app', a.attrelid, a.attnum, 'UPDATE') ORDER BY 1`)
      .then((r) => r.map((c) => c.columna));
  expect(await actualizables("ConceptoDeGasto"), `${etiqueta}: UPDATE del concepto, solo nombre, tipo y activo`).toEqual(["activo", "nombre", "tipoDeCostoPorDefecto"]);
  expect(await actualizables("ImputacionDeGasto"), `${etiqueta}: ninguna columna de la imputación se actualiza`).toEqual([]);
  expect(await actualizables("FacturaProveedorRenglon"), `${etiqueta}: ninguna columna del renglón se actualiza`).toEqual([]);

  // M4.4: las cuatro políticas de sucursal de la imputación y las anteriores intactas.
  const deAlcance = f.politicas.filter((p) => String(p.nombre).startsWith("alcance_sucursal_"));
  const deLaImputacion = deAlcance.filter((p) => p.tabla === "ImputacionDeGasto");
  expect(deLaImputacion.map((p) => p.cmd).sort(), `${etiqueta}: 4 políticas de sucursal en la imputación`).toEqual(["DELETE", "INSERT", "SELECT", "UPDATE"]);
  for (const p of deLaImputacion) expect([p.permissive, p.roles], `${etiqueta}: ${p.nombre} RESTRICTIVE para motor2_app`).toEqual(["RESTRICTIVE", "{motor2_app}"]);
  expect(deAlcance, `${etiqueta}: 128 del Paquete 1 + 4 de Venta + 4 de la parte + 4 de la imputación`).toHaveLength(TABLAS_DEL_PAQUETE_1.length * COMANDOS_CON_POLITICA_DE_ALCANCE.length + 12);
  expect(f.politicas.filter((p) => p.tabla === "ConceptoDeGasto").map((p) => p.nombre), `${etiqueta}: el concepto, solo con la política de empresa`).toEqual(["aislamiento_empresa"]);

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
  await base.cliente.query(`DELETE FROM "ImputacionDeGasto"`);
  await base.cliente.query(`DELETE FROM "FacturaProveedorRenglon"`);
  await base.cliente.query(`DELETE FROM "FacturaProveedorSucursal"`);
  await base.cliente.query(`DELETE FROM "FacturaProveedor"`);
  await base.cliente.query(`DELETE FROM "ConceptoDeGasto"`);
  await base.cliente.query(insertarFactura("fact_humo", E));
  await base.cliente.query(insertarConcepto("con_humo", "ALQUILER", E));
  await base.cliente.query(insertarRenglonSinStock("ren_humo", "fact_humo", "con_humo", 1, E));
  await base.cliente.query(`INSERT INTO "FacturaProveedorRenglon" ("empresaId","id","facturaProveedorId","orden","naturaleza","productoId","cantidadStock","precioPorUnidadStock","detalle","precioTotal") VALUES ('${E}','ren_merc','fact_humo',2,'MERCADERIA','pro_m4',1,100,'1 kg',100.00)`);
  await base.cliente.query(insertarImputacion("imp_a", "ren_humo", "suc_a", E, "120.00"));
  await base.cliente.query(insertarImputacion("imp_b", "ren_humo", "suc_b", E, "80.00"));
  await comoApp({}, async (c) => {
    expect((await c.query(`SELECT id FROM "ConceptoDeGasto"`)).rows, `${etiqueta}: el concepto (de empresa) se ve aun sin alcance`).toEqual([{ id: "con_humo" }]);
    expect((await c.query(`SELECT id FROM "ImputacionDeGasto"`)).rows, `${etiqueta}: sin alcance no se ve ninguna imputación (falla cerrado)`).toEqual([]);
  });
  await comoApp({ lectura: "suc_a", escritura: "suc_a" }, async (c) => {
    expect((await c.query(`SELECT id FROM "ImputacionDeGasto" ORDER BY id`)).rows, `${etiqueta}: con la sucursal A solo se ve su imputación`).toEqual([{ id: "imp_a" }]);
    expect((await c.query(`SELECT id FROM "FacturaProveedorRenglon" WHERE naturaleza = 'SIN_STOCK'`)).rows, `${etiqueta}: el renglón (de empresa) se ve desde cualquier sucursal`).toEqual([{ id: "ren_humo" }]);
    expect(await falla(c, insertarConcepto("con_nuevo", "LUZ")), `${etiqueta}: dar de alta un concepto anda`).toBeNull();
    expect(await falla(c, insertarConcepto("con_dup", "LUZ")), `${etiqueta}: el código repetido da 23505`).toBe("23505");
    expect(await falla(c, `UPDATE "ConceptoDeGasto" SET "codigo" = 'OTRO' WHERE id = 'con_humo'`), `${etiqueta}: UPDATE del código da 42501`).toBe("42501");
    expect(await falla(c, `UPDATE "ConceptoDeGasto" SET "activo" = false WHERE id = 'con_humo'`), `${etiqueta}: desactivar anda`).toBeNull();
    expect(await falla(c, `DELETE FROM "ConceptoDeGasto" WHERE id = 'con_humo'`), `${etiqueta}: DELETE del concepto da 42501`).toBe("42501");
    expect(await falla(c, insertarRenglonSinStock("ren_app", "fact_humo", "con_humo", 3)), `${etiqueta}: cargar un renglón sin stock anda`).toBeNull();
    expect(await falla(c, insertarImputacion("imp_app", "ren_app", "suc_a")), `${etiqueta}: imputar en la propia sucursal anda`).toBeNull();
    expect(await falla(c, insertarImputacion("imp_ajena", "ren_app", "suc_b")), `${etiqueta}: imputar en otra sucursal da 42501`).toBe("42501");
    expect(await falla(c, insertarImputacion("imp_merc", "ren_merc", "suc_a")), `${etiqueta}: imputar mercadería da 23503`).toBe("23503");
    expect(await falla(c, `UPDATE "ImputacionDeGasto" SET "importe" = 1 WHERE id = 'imp_a'`), `${etiqueta}: UPDATE del importe da 42501`).toBe("42501");
    expect(await falla(c, `DELETE FROM "ImputacionDeGasto" WHERE id = 'imp_a'`), `${etiqueta}: DELETE de la imputación da 42501`).toBe("42501");
    expect(await falla(c, `UPDATE "FacturaProveedorRenglon" SET "naturaleza" = 'MERCADERIA' WHERE id = 'ren_humo'`), `${etiqueta}: UPDATE de la naturaleza del renglón da 42501`).toBe("42501");
  });
}

let antesDeM3: Awaited<ReturnType<typeof foto>>;
let antesDeM4: Awaited<ReturnType<typeof foto>>;
let arribaLaPrimeraVez: Awaited<ReturnType<typeof foto>>;

beforeAll(async () => {
  base = await crearBaseTemporalMigrada();
  hayRol = (await base.cliente.query("SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app'")).rowCount === 1;
  if (!hayRol) return; // sin el rol, `CREATE POLICY … TO motor2_app` falla: el archivo omite sus casos con motivo (como los demás tests de RLS).
  await base.aplicarHasta(ULTIMA_DEL_PAQUETE_2);
  await base.cliente.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO motor2_app`);
  // Datos que existen ANTES de M3 y de M4 y que ninguna reversa borra: una empresa con dos sucursales, un usuario, un proveedor, un producto, su rol admin (y uno que no lo es).
  const c = base.cliente;
  await c.query(`INSERT INTO "Empresa" ("id","nombre","slug","zonaHoraria","moneda","estado") VALUES ($1,$1,$1,'America/Argentina/Buenos_Aires','ARS','ACTIVE')`, [E]);
  await c.query(`INSERT INTO "Sucursal" ("id","empresaId","nombre") VALUES ('suc_a',$1,'Centro'), ('suc_b',$1,'Norte')`, [E]);
  await c.query(`INSERT INTO "User" ("id","email") VALUES ('u_m4','m4@ejemplo.test')`);
  await c.query(`INSERT INTO "Rol" ("id","empresaId","nombre","clave") VALUES ('rol_admin_m4',$1,'admin','admin'), ('rol_otro_m4',$1,'encargado',NULL)`, [E]);
  await c.query(`INSERT INTO "Proveedor" ("id","empresaId","codigo","nombre") VALUES ('prov_m4',$1,'PRV_M4','Proveedor')`, [E]);
  await c.query(`INSERT INTO "Unidad" ("id","empresaId","nombre","magnitud") VALUES ('uni_m4',$1,'kg','PESO')`, [E]);
  await c.query(`INSERT INTO "Producto" ("id","empresaId","codigo","nombre","tipo","unidadStockId") VALUES ('pro_m4',$1,'MP_M4','Harina','MP','uni_m4')`, [E]);
  antesDeM3 = await foto();
  for (const m of M3) await correr(m, "migration.sql");
  antesDeM4 = await foto();
}, 180_000);

afterAll(async () => {
  await app?.end().catch(() => undefined);
  await base?.eliminar();
});

describe("M4: subir, bajar y subir (M4.1 a M4.5) sobre una base temporal con el Paquete 2 y M3 aplicados", () => {
  it("0. las cinco migraciones existen, son posteriores a M3, van en este orden, avisan que requieren autorización y la de políticas está declarada como posterior (el Paquete 1 queda intacto)", () => {
    expect([...SUBIDA].sort()).toEqual(SUBIDA);
    for (const m of SUBIDA) {
      expect(m > M3.at(-1)!, `${m} es posterior a M3`).toBe(true);
      expect(sql(m, "migration.sql").split("\n")[0], `${m}: avisa que requiere autorización`).toContain("REQUIERE AUTORIZACIÓN EXPRESA");
      expect(sql(m, "down.sql").length, `${m}: tiene down.sql`).toBeGreaterThan(0);
    }
    expect(MIGRACIONES_DE_POLITICAS_POSTERIORES.map((g) => g.migracion)).toContain(M4_4);
    expect(MIGRACIONES_DE_POLITICAS_DE_SUCURSAL.map((g) => g.migracion)).not.toContain(M4_4);
    expect(TABLAS_DEL_PAQUETE_1).not.toContain("ImputacionDeGasto");
    expect(TABLAS_DEL_PAQUETE_1).toHaveLength(32);
    expect(sql(M4_2, "migration.sql")).toMatch(/REEMPLAZA DOS CHECK DE M3/);
    expect(sql(M4_2, "down.sql")).toMatch(/ABORTA/);
  });

  it("1. SUBIR: M4.1 a M4.5 sobre una base con M3 y datos previos dejan todo arriba (tablas, reglas, índices, claves foráneas, CHECK reemplazados, privilegios exactos, política de sucursal de la imputación y las siete claves) y andan como motor2_app", async (ctx) => {
    if (!hayRol) return ctx.skip();
    for (const m of SUBIDA) await correr(m, "migration.sql");
    await comprobarArriba("primera subida");
    arribaLaPrimeraVez = await foto();
    expect(arribaLaPrimeraVez.columnas.length, "sanidad de la foto").toBeGreaterThan(antesDeM4.columnas.length + 15);
  });

  it("2. BAJAR (con datos nuevos escritos): la reversa de M4.2 ABORTA mientras haya un renglón sin stock; sin él, M4.5 a M4.1 en orden inverso dejan el catálogo como estaba antes de M4 y los dos CHECK de M3 con su definición exacta", async (ctx) => {
    if (!hayRol) return ctx.skip();
    // Datos que solo existen por M4 (escritos por el dueño): un concepto, un renglón sin stock imputado a las dos sucursales, y la configuración de una de las claves.
    const c = base.cliente;
    await c.query(`UPDATE "PermisoRol" SET "puedeEditar" = false WHERE "rolId" = 'rol_admin_m4' AND "accionClave" = 'gasto_anular'`);
    expect(Number((await q<{ n: string }>(`SELECT count(*) AS n FROM "ImputacionDeGasto"`))[0]!.n), "hay imputaciones que la reversa va a perder").toBeGreaterThan(0);

    await correr(M4_5, "down.sql");
    expect(await q(`SELECT 1 FROM "Accion" WHERE "clave" = ANY($1)`, [CLAVES]), "sin las siete claves").toEqual([]);
    expect(await q(`SELECT 1 FROM "PermisoRol" WHERE "accionClave" = ANY($1)`, [CLAVES]), "sin lo configurado sobre ellas").toEqual([]);
    await correr(M4_4, "down.sql");
    expect(await q(`SELECT 1 FROM pg_policies WHERE tablename = 'ImputacionDeGasto' AND policyname LIKE 'alcance\\_sucursal\\_%'`), "sin las políticas de sucursal de la imputación").toEqual([]);
    await correr(M4_3, "down.sql");
    expect(await q(`SELECT 1 FROM pg_class WHERE relname = 'ImputacionDeGasto' AND relnamespace = 'public'::regnamespace`), "sin la tabla de imputaciones").toEqual([]);

    // La reversa de M4.2 ABORTA: hay renglones sin stock (el del humo y el de la app). Nada queda a medias.
    const antes = { restricciones: (await foto()).restricciones, columnas: (await foto()).columnas };
    await expect(correr(M4_2, "down.sql")).rejects.toThrow(/No se puede bajar M4\.2: hay \d+ renglón/);
    const intacto = await foto();
    expect(intacto.restricciones, "el aborto no deja nada a medias (restricciones)").toEqual(antes.restricciones);
    expect(intacto.columnas, "el aborto no deja nada a medias (columnas)").toEqual(antes.columnas);
    // Hasta que se decide qué hacer con esos gastos (anular y resguardar), la bajada no sigue: el dueño los saca a mano.
    await c.query(`DELETE FROM "FacturaProveedorRenglon" WHERE "naturaleza" = 'SIN_STOCK'`);
    await correr(M4_2, "down.sql");
    await correr(M4_1, "down.sql");

    const despues = await foto();
    for (const k of Object.keys(antesDeM4) as (keyof typeof antesDeM4)[]) expect(despues[k], `catálogo «${k}» igual que antes de M4`).toEqual(antesDeM4[k]);
    for (const t of TABLAS_NUEVAS) expect(await q(`SELECT 1 FROM pg_class WHERE relname = '${t}' AND relnamespace = 'public'::regnamespace`), `sin la tabla ${t}`).toEqual([]);
    expect((await q<{ id: string }>(`SELECT id FROM "FacturaProveedorRenglon" ORDER BY id`)).map((r) => r.id), "el renglón de mercadería sigue (la reversa no borra lo de M3)").toEqual(["ren_merc"]);
    expect(Number((await q<{ n: string }>(`SELECT count(*) AS n FROM "Rol"`))[0]!.n), "los roles siguen").toBe(2);
    expect(Number((await q<{ n: string }>(`SELECT count(*) AS n FROM "Sucursal"`))[0]!.n), "las sucursales siguen").toBe(2);
  });

  it("3. SUBIR OTRA VEZ: las mismas comprobaciones, el catálogo es idéntico al de la primera subida y lo que se perdió (conceptos, imputaciones, claves) quedó vacío", async (ctx) => {
    if (!hayRol) return ctx.skip();
    for (const m of SUBIDA) await correr(m, "migration.sql");
    for (const t of TABLAS_NUEVAS) expect(Number((await q<{ n: string }>(`SELECT count(*) AS n FROM "${t}"`))[0]!.n), `${t} volvió vacía`).toBe(0);
    await comprobarArriba("segunda subida");
    const otraVez = await foto();
    for (const k of Object.keys(arribaLaPrimeraVez) as (keyof typeof arribaLaPrimeraVez)[]) expect(otraVez[k], `catálogo «${k}» igual que la primera vez`).toEqual(arribaLaPrimeraVez[k]);
  });

  it("4. EL CICLO COMPLETO DE M3 MÁS M4: se baja todo (M4.5 a M4.1 y M3e a M3a) hasta el Paquete 2, el catálogo es idéntico al de entonces, y se sube todo otra vez hasta el mismo catálogo", async (ctx) => {
    if (!hayRol) return ctx.skip();
    // Sin gastos cargados (la reversa de M4.2 aborta si los hay): quedan solo las tablas vacías y las filas de M3 que M3 sabe perder.
    await base.cliente.query(`DELETE FROM "ImputacionDeGasto"`);
    await base.cliente.query(`DELETE FROM "FacturaProveedorRenglon" WHERE "naturaleza" = 'SIN_STOCK'`);
    for (const m of BAJADA) await correr(m, "down.sql");
    for (const m of [...M3].reverse()) await correr(m, "down.sql");
    const despues = await foto();
    for (const k of Object.keys(antesDeM3) as (keyof typeof antesDeM3)[]) expect(despues[k], `catálogo «${k}» igual que antes de M3`).toEqual(antesDeM3[k]);
    for (const m of [...M3, ...SUBIDA]) await correr(m, "migration.sql");
    await comprobarArriba("ciclo completo");
    const otraVez = await foto();
    for (const k of Object.keys(arribaLaPrimeraVez) as (keyof typeof arribaLaPrimeraVez)[]) expect(otraVez[k], `catálogo «${k}» igual que la primera vez`).toEqual(arribaLaPrimeraVez[k]);
  });

  it("5. Las reversas son idempotentes (IF EXISTS): bajar dos veces no falla; bajar solo M4.4 deja la imputación con la RLS de empresa y las demás políticas intactas; y volver a subir deja todo arriba", async (ctx) => {
    if (!hayRol) return ctx.skip();
    await correr(M4_4, "down.sql");
    await correr(M4_4, "down.sql");
    const politicas = await q<{ tabla: string; nombre: string }>(`SELECT tablename::text AS tabla, policyname::text AS nombre FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ImputacionDeGasto'`);
    expect(politicas, "la imputación queda solo con la política de empresa").toEqual([{ tabla: "ImputacionDeGasto", nombre: "aislamiento_empresa" }]);
    const deAlcance = await q(`SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND policyname LIKE 'alcance\\_sucursal\\_%'`);
    expect(deAlcance, "las del Paquete 1, las de Venta y las de la parte siguen").toHaveLength(TABLAS_DEL_PAQUETE_1.length * COMANDOS_CON_POLITICA_DE_ALCANCE.length + 8);
    await correr(M4_4, "migration.sql");
    await base.cliente.query(`DELETE FROM "ImputacionDeGasto"`);
    await base.cliente.query(`DELETE FROM "FacturaProveedorRenglon" WHERE "naturaleza" = 'SIN_STOCK'`);
    for (const m of BAJADA) {
      await correr(m, "down.sql");
      await correr(m, "down.sql");
    }
    const despues = await foto();
    for (const k of Object.keys(antesDeM4) as (keyof typeof antesDeM4)[]) expect(despues[k], `catálogo «${k}» igual que antes de M4`).toEqual(antesDeM4[k]);
    for (const m of SUBIDA) await correr(m, "migration.sql");
    await comprobarArriba("tercera subida");
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// PAQUETE 4, M5 (`ReclasificacionRenglon`): sigue en el MISMO archivo para reutilizar la base temporal, la foto del catálogo y los ayudantes, y parte del estado que dejó el último caso de M4 (todo arriba, con datos de humo).
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
const M5 = "20261017100000_reclasificacion_renglon";
const FK_M5_DISCRIMINADOR = "ReclasificacionRenglon_empresaId_facturaProveedorRenglonId_fkey";
const CHECKS_M5 = ["ReclasificacionRenglon_motivo_chk", "ReclasificacionRenglon_naturaleza_chk", "ReclasificacionRenglon_numero_chk", "ReclasificacionRenglon_tipo_de_costo_chk"];
const CLAVES_FORANEAS_M5 = [FK_M5_DISCRIMINADOR, "ReclasificacionRenglon_creadoPorId_fkey", "ReclasificacionRenglon_empresaId_conceptoGastoId_fkey", "ReclasificacionRenglon_empresaId_fkey"];

const insertarReclasificacion = (id: string, renglon: string, numero: number, extra: { empresa?: string; concepto?: string } = {}) =>
  `INSERT INTO "ReclasificacionRenglon" (${extra.empresa ? '"empresaId",' : ""}"id","facturaProveedorRenglonId","numero","conceptoGastoId","tipoDeCosto","motivo","claveIdempotencia","payloadHash","resultadoMensaje","creadoPorId")
   VALUES (${extra.empresa ? `'${extra.empresa}',` : ""}'${id}','${renglon}',${numero},'${extra.concepto ?? "con_humo"}','INVERSION','Era una obra','clave_${id}','huella','Reclasificado.','u_m4')`;

/** Las comprobaciones de «M5 aplicada» (el humo corre en transacciones que se deshacen: no deja ninguna reclasificación). */
async function comprobarArribaM5(etiqueta: string) {
  const f = await foto();
  expect(f.rls.find((r) => r.tabla === "ReclasificacionRenglon"), `${etiqueta}: la tabla con RLS y sin FORCE`).toEqual({ tabla: "ReclasificacionRenglon", rls: true, forzado: false });
  expect(f.columnas.filter((c) => c.tabla === "ReclasificacionRenglon").map((c) => `${c.columna}:${c.is_nullable}`), `${etiqueta}: las columnas, todas NOT NULL`).toEqual([
    "id:NO", "empresaId:NO", "facturaProveedorRenglonId:NO", "naturalezaRenglon:NO", "numero:NO", "conceptoGastoId:NO", "tipoDeCosto:NO", "motivo:NO", "claveIdempotencia:NO", "payloadHash:NO", "resultadoMensaje:NO", "creadoPorId:NO", "creadoEn:NO",
  ]);
  expect(f.columnas.filter((c) => c.tabla === "ReclasificacionRenglon" && /numeric|double|real/.test(String(c.data_type))), `${etiqueta}: ninguna columna de dinero`).toEqual([]);
  const delaTabla = f.restricciones.filter((r) => r.tabla === '"ReclasificacionRenglon"');
  expect(delaTabla.filter((r) => r.contype === "c").map((r) => r.nombre), `${etiqueta}: los cuatro CHECK`).toEqual(CHECKS_M5);
  expect(delaTabla.filter((r) => r.contype === "c").every((r) => r.convalidated), `${etiqueta}: los CHECK validados`).toBe(true);
  expect(delaTabla.filter((r) => r.contype === "f").map((r) => r.nombre), `${etiqueta}: las cuatro claves foráneas`).toEqual([...CLAVES_FORANEAS_M5].sort());
  expect(String(delaTabla.find((r) => r.nombre === FK_M5_DISCRIMINADOR)!.definicion), `${etiqueta}: la clave foránea lleva el discriminador y ON UPDATE RESTRICT`).toBe(
    'FOREIGN KEY ("empresaId", "facturaProveedorRenglonId", "naturalezaRenglon") REFERENCES "FacturaProveedorRenglon"("empresaId", id, naturaleza) ON UPDATE RESTRICT ON DELETE RESTRICT',
  );
  expect(f.indices.filter((i) => i.tabla === "ReclasificacionRenglon").map((i) => i.nombre), `${etiqueta}: los índices`).toEqual([
    "ReclasificacionRenglon_claveIdempotencia_key", "ReclasificacionRenglon_conceptoGastoId_idx", "ReclasificacionRenglon_empresaId_id_key", "ReclasificacionRenglon_facturaProveedorRenglonId_numero_key", "ReclasificacionRenglon_pkey",
  ]);
  expect(f.politicas.filter((p) => p.tabla === "ReclasificacionRenglon").map((p) => p.nombre), `${etiqueta}: UNA sola política (DE EMPRESA: sin políticas de sucursal)`).toEqual(["aislamiento_empresa"]);
  expect(f.privilegios.filter((p) => p.tabla === "ReclasificacionRenglon"), `${etiqueta}: solo se agrega; motor2_plataforma, nada`).toEqual([
    { tabla: "ReclasificacionRenglon", rol: "motor2_app", privilege_type: "INSERT" }, { tabla: "ReclasificacionRenglon", rol: "motor2_app", privilege_type: "SELECT" },
  ]);
  expect(f.privilegiosDeColumna.filter((p) => p.tabla === "ReclasificacionRenglon" && p.privilege_type === "UPDATE"), `${etiqueta}: ninguna columna con UPDATE`).toEqual([]);
  expect(f.politicas.filter((p) => String(p.nombre).startsWith("alcance_sucursal_")), `${etiqueta}: M5 no suma políticas de sucursal`).toHaveLength(TABLAS_DEL_PAQUETE_1.length * COMANDOS_CON_POLITICA_DE_ALCANCE.length + 12);

  // Los gastos del humo: se vuelven a sembrar como dueño (una reversa anterior pudo haberlos sacado), con la tabla de M5 vacía primero (sus claves foráneas frenarían el borrado del renglón).
  const c = base.cliente;
  for (const tabla of ["ReclasificacionRenglon", "ImputacionDeGasto", "FacturaProveedorRenglon", "FacturaProveedorSucursal", "FacturaProveedor", "ConceptoDeGasto"]) await c.query(`DELETE FROM "${tabla}"`);
  await c.query(insertarFactura("fact_humo", E));
  await c.query(insertarConcepto("con_humo", "ALQUILER", E));
  await c.query(insertarRenglonSinStock("ren_humo", "fact_humo", "con_humo", 1, E));
  await c.query(`INSERT INTO "FacturaProveedorRenglon" ("empresaId","id","facturaProveedorId","orden","naturaleza","productoId","cantidadStock","precioPorUnidadStock","detalle","precioTotal") VALUES ('${E}','ren_merc','fact_humo',2,'MERCADERIA','pro_m4',1,100,'1 kg',100.00)`);

  // Humo como el rol real de la app (todo dentro de una transacción que se deshace).
  app ??= await conectarComoApp();
  await app.query("BEGIN");
  try {
    await app.query("SELECT set_config('app.empresa_id', $1, true)", [E]);
    expect(await falla(app, insertarReclasificacion("rec_humo", "ren_humo", 1)), `${etiqueta}: reclasificar un renglón sin stock anda, sin alcance de sucursal`).toBeNull();
    expect((await app.query(`SELECT id FROM "ReclasificacionRenglon"`)).rows, `${etiqueta}: se ve la propia`).toEqual([{ id: "rec_humo" }]);
    expect(await falla(app, insertarReclasificacion("rec_dup", "ren_humo", 1)), `${etiqueta}: repetir (renglón, número) da 23505`).toBe("23505");
    expect(await falla(app, insertarReclasificacion("rec_merc", "ren_merc", 1)), `${etiqueta}: reclasificar mercadería da 23503`).toBe("23503");
    expect(await falla(app, `UPDATE "ReclasificacionRenglon" SET "tipoDeCosto" = 'EXTRAORDINARIO' WHERE id = 'rec_humo'`), `${etiqueta}: UPDATE da 42501`).toBe("42501");
    expect(await falla(app, `DELETE FROM "ReclasificacionRenglon" WHERE id = 'rec_humo'`), `${etiqueta}: DELETE da 42501`).toBe("42501");
    expect(await falla(app, `UPDATE "FacturaProveedorRenglon" SET "tipoDeCosto" = 'EXTRAORDINARIO' WHERE id = 'ren_humo'`), `${etiqueta}: el renglón sigue sin UPDATE (la versión 0 es inmutable)`).toBe("42501");
  } finally {
    await app.query("ROLLBACK");
  }
  expect(Number((await q<{ n: string }>(`SELECT count(*) AS n FROM "ReclasificacionRenglon"`))[0]!.n), `${etiqueta}: el humo no dejó ninguna fila`).toBe(0);
}

let antesDeM5: Awaited<ReturnType<typeof foto>>;
let arribaConM5: Awaited<ReturnType<typeof foto>>;

describe("M5: subir, bajar y subir (`ReclasificacionRenglon`) sobre el estado que deja M4 con todo arriba", () => {
  it("6.0. la migración existe, es posterior a M4.5, avisa que requiere autorización, tiene down.sql que ABORTA, no es una migración de políticas de sucursal y su SQL no nombra políticas de alcance", () => {
    expect(M5 > M4_5, "M5 es posterior a M4.5").toBe(true);
    expect(sql(M5, "migration.sql").split("\n")[0]).toContain("REQUIERE AUTORIZACIÓN EXPRESA");
    expect(sql(M5, "down.sql")).toMatch(/ABORTA/);
    expect(sql(M5, "down.sql")).toContain('DROP TABLE IF EXISTS "ReclasificacionRenglon"');
    for (const archivo of ["migration.sql", "down.sql"] as const) {
      expect(sql(M5, archivo), `${archivo} no nombra políticas de alcance de sucursal`).not.toContain("alcance_sucursal_");
      expect(sql(M5, archivo), `${archivo} no nombra el ayudante de alcance`).not.toContain("app_sucursales_");
    }
    expect(MIGRACIONES_DE_POLITICAS_POSTERIORES.map((g) => g.migracion)).not.toContain(M5);
    expect(MIGRACIONES_DE_POLITICAS_DE_SUCURSAL.map((g) => g.migracion)).not.toContain(M5);
    expect(TABLAS_DEL_PAQUETE_1).not.toContain("ReclasificacionRenglon");
  });

  it("6.1. SUBIR: M5 sobre M4 con todo arriba deja la tabla, las claves foráneas, los CHECK, la política, los privilegios exactos y un humo como motor2_app", async (ctx) => {
    if (!hayRol) return ctx.skip();
    antesDeM5 = await foto();
    expect(antesDeM5.rls.find((r) => r.tabla === "ReclasificacionRenglon"), "antes de M5 la tabla no existe").toBeUndefined();
    await correr(M5, "migration.sql");
    await comprobarArribaM5("primera subida de M5");
    arribaConM5 = await foto();
  });

  it("6.2. BAJAR CON DATOS: la reversa ABORTA mientras haya reclasificaciones; con M5 arriba las reversas de M4.2 y M4.1 FALLAN sin dejar nada a medias; sin filas la de M5 pasa y el catálogo queda como antes de M5", async (ctx) => {
    if (!hayRol) return ctx.skip();
    const c = base.cliente;
    await c.query(insertarReclasificacion("rec_1", "ren_humo", 1, { empresa: E }));
    await c.query(insertarReclasificacion("rec_2", "ren_humo", 2, { empresa: E }));
    // 1) ABORTA con filas, sin tocar nada.
    await expect(correr(M5, "down.sql")).rejects.toThrow(/No se puede bajar M5: hay 2 reclasificación/);
    const sinTocar = await foto();
    for (const k of Object.keys(arribaConM5) as (keyof typeof arribaConM5)[]) expect(sinTocar[k], `el aborto no deja nada a medias («${k}»)`).toEqual(arribaConM5[k]);
    expect(Number((await q<{ n: string }>(`SELECT count(*) AS n FROM "ReclasificacionRenglon"`))[0]!.n), "las dos reclasificaciones siguen").toBe(2);

    // 2) Con M5 arriba (aun vacía), el down de M4.2 y el de M4.1 FALLAN por dependencia: la clave foránea de M5 depende del índice del discriminador y del catálogo. Se bajan antes M4.5, M4.4 y M4.3 y se sacan los gastos, para que
    //    la que frene NO sea la guarda de datos de M4.2 sino la dependencia.
    await c.query(`DELETE FROM "ReclasificacionRenglon"`);
    await correr(M4_5, "down.sql");
    await correr(M4_4, "down.sql");
    await correr(M4_3, "down.sql");
    await c.query(`DELETE FROM "FacturaProveedorRenglon" WHERE "naturaleza" = 'SIN_STOCK'`);
    const bloqueada = await foto();
    await expect(correr(M4_2, "down.sql")).rejects.toMatchObject({ code: "2BP01" });
    await expect(correr(M4_1, "down.sql")).rejects.toMatchObject({ code: "2BP01" });
    const intacta = await foto();
    for (const k of Object.keys(bloqueada) as (keyof typeof bloqueada)[]) expect(intacta[k], `las reversas bloqueadas no dejan nada a medias («${k}»)`).toEqual(bloqueada[k]);
    // Se vuelve a subir lo que se bajó para probar la reversa de M5 en el estado de antes.
    for (const m of [M4_3, M4_4, M4_5]) await correr(m, "migration.sql");
    const restaurada = await foto();
    for (const k of Object.keys(arribaConM5) as (keyof typeof arribaConM5)[]) expect(restaurada[k], `catálogo «${k}» igual que con M5 arriba`).toEqual(arribaConM5[k]);

    // 3) Sin filas, la reversa de M5 pasa y el catálogo queda IDÉNTICO al de antes de M5.
    await correr(M5, "down.sql");
    const despues = await foto();
    for (const k of Object.keys(antesDeM5) as (keyof typeof antesDeM5)[]) expect(despues[k], `catálogo «${k}» igual que antes de M5`).toEqual(antesDeM5[k]);
    expect(await q(`SELECT 1 FROM pg_class WHERE relname = 'ReclasificacionRenglon' AND relnamespace = 'public'::regnamespace`), "sin la tabla").toEqual([]);
  });

  it("6.3. SUBIR OTRA VEZ: las mismas comprobaciones y el catálogo es idéntico al de la primera subida", async (ctx) => {
    if (!hayRol) return ctx.skip();
    await correr(M5, "migration.sql");
    await comprobarArribaM5("segunda subida de M5");
    const otraVez = await foto();
    for (const k of Object.keys(arribaConM5) as (keyof typeof arribaConM5)[]) expect(otraVez[k], `catálogo «${k}» igual que la primera vez`).toEqual(arribaConM5[k]);
  });

  it("6.4. EL CICLO COMPLETO: se baja M5, M4.5 a M4.1 y M3e a M3a hasta el Paquete 2 (catálogo idéntico al de entonces) y se sube todo otra vez hasta el mismo catálogo con M5 arriba", async (ctx) => {
    if (!hayRol) return ctx.skip();
    // Sin gastos cargados (la reversa de M4.2 aborta si los hay), como en el ciclo de M4. Con reclasificaciones cargadas tampoco se podría borrar un renglón (RESTRICT): la tabla de M5 se vacía antes.
    await base.cliente.query(`DELETE FROM "ReclasificacionRenglon"`);
    await base.cliente.query(`DELETE FROM "ImputacionDeGasto"`);
    await base.cliente.query(`DELETE FROM "FacturaProveedorRenglon" WHERE "naturaleza" = 'SIN_STOCK'`);
    for (const m of [M5, ...BAJADA]) await correr(m, "down.sql");
    for (const m of [...M3].reverse()) await correr(m, "down.sql");
    const abajo = await foto();
    for (const k of Object.keys(antesDeM3) as (keyof typeof antesDeM3)[]) expect(abajo[k], `catálogo «${k}» igual que antes de M3`).toEqual(antesDeM3[k]);
    for (const m of [...M3, ...SUBIDA, M5]) await correr(m, "migration.sql");
    await comprobarArribaM5("ciclo completo");
    const otraVez = await foto();
    for (const k of Object.keys(arribaConM5) as (keyof typeof arribaConM5)[]) expect(otraVez[k], `catálogo «${k}» igual que la primera vez`).toEqual(arribaConM5[k]);
  });

  it("6.5. La reversa de M5 es idempotente (IF EXISTS): bajar dos veces no falla, deja el catálogo de antes de M5, y volver a subir deja todo arriba", async (ctx) => {
    if (!hayRol) return ctx.skip();
    await correr(M5, "down.sql");
    await correr(M5, "down.sql");
    const abajo = await foto();
    for (const k of Object.keys(antesDeM5) as (keyof typeof antesDeM5)[]) expect(abajo[k], `catálogo «${k}» igual que antes de M5`).toEqual(antesDeM5[k]);
    await correr(M5, "migration.sql");
    await comprobarArribaM5("tercera subida de M5");
  });
});
