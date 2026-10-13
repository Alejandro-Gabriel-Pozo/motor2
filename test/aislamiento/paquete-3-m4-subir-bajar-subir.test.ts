import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";
import { clavesReservadasDe } from "../setup/claves-reservadas-en-base";
import { MIGRACION_B1_FUNCIONES, MIGRACIONES_DE_POLITICAS_DE_SUCURSAL, MIGRACIONES_DE_POLITICAS_POSTERIORES, TABLAS_DEL_PAQUETE_1 } from "../setup/migraciones-de-alcance-de-sucursal";
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
 *  7. PAQUETE 4, M6 (la NOTA DE CRÉDITO DE PROVEEDOR, cuatro migraciones M6.1 a M6.4, sobre el estado que deja M5 con todo arriba): SUBIR (las cuatro tablas, las seis claves foráneas de tres columnas, los CHECK, los índices, las políticas 1, 1, 5 y 1, los
 *     privilegios exactos, el CHECK de `Operacion` que admite anular una devolución, las tres claves de permiso y un humo como `motor2_app`); BAJAR CON DATOS (las reversas de M6.4, M6.3 y M6.1 ABORTAN cada una por su motivo sin dejar nada a medias; con M6.1
 *     arriba las reversas de M4.2, M4.1 y M3b FALLAN, enteras y a propósito, con 2BP01; sin filas M6.4 a M6.1 dejan el catálogo como antes de M6); SUBIR OTRA VEZ; el CICLO COMPLETO (M6, M5, M4 y M3 hasta el Paquete 2 y de vuelta hasta M6 arriba) y las
 *     cuatro reversas idempotentes. Los casos 0 a 6.5 no cambian.
 *  8. PAQUETE 5, M7 (CENTROS DE COSTOS: M7.1 a M7.4, cuatro migraciones, sobre el estado que deja M6 con todo arriba): SUBIR (las cinco tablas, CHECK, claves foráneas de tres columnas, únicos, políticas, privilegios exactos de tabla y por columna, las tres claves
 *     del admin y un humo como `motor2_app`); BAJAR CON DATOS (la reversa de M7.4 ABORTA con la configuración tocada; con M7 arriba la de M4.3 FALLA con 2BP01 sin dejar nada a medias; la de M7.3 pasa; las de M7.2 y M7.1 ABORTAN con filas; sin filas el catálogo queda
 *     idéntico al de antes de M7); SUBIR OTRA VEZ; el CICLO COMPLETO (M7.4 a M7.1, M6.4 a M6.1, M5, M4.5 a M4.1 y M3 hasta el Paquete 2, y de vuelta hasta M7 arriba); y las reversas de M7 idempotentes. Los casos 0 a 7.5 no cambian.
 *     ORDEN DE EJECUCIÓN: M6 (caso 7) corre ANTES que M7 (caso 8), y cada bloque es autocontenido: el de M6 parte de M5 arriba SIN M7 (M6 y M7 son independientes entre sí; M7 se agregó sin M6) y deja M3 a M6 arriba; el de M7 parte de ahí. Con las tablas de M6 arriba, M7 tiene
 *     que vaciar las notas antes de tocar los gastos y bajar M6 antes que M5 y que M4.x cuando recorre el ciclo completo (reversa: M7, M6, M5, M4, M3).
 *  9. GO-1 (los GRUPOS DE OPCIONES DE VENTA, el «elemento configurable»: seis migraciones GO-1a, GO-1b, GO-1c, GO-1c-rls, GO-1d y GO-1d-rls, sobre el estado que deja M7 con todo arriba): SUBIR (las nueve tablas, los CHECK, las claves foráneas, los únicos y parciales, las políticas 1 por
 *     tabla del catálogo y 5 en las tres de sucursal —el total de alcance pasa a +12—, los tres disparadores con su definición exacta, las columnas nuevas de `CuentaItem` y `Operacion`, los privilegios exactos de tabla y por columna, las tres claves del admin y un humo como `motor2_app`);
 *     BAJAR CON DATOS (cada reversa ABORTA por su motivo sin dejar nada a medias; con la foto y los precios arriba la de GO-1b FALLA con 2BP01 y con GO-1d-rls arriba la de B1 también; sin filas, de GO-1d-rls a GO-1a el catálogo queda idéntico al de antes de GO-1); SUBIR OTRA VEZ;
 *     INDEPENDENCIA (con GO-1 arriba, M7, M6 y M5 bajan y suben sin tocar GO-1) y el CICLO COMPLETO (GO-1, M7, M6, M5, M4 y M3 hasta el Paquete 2 y de vuelta hasta GO-1 arriba); y las seis reversas idempotentes. Los casos 0 a 8.5 no cambian y el bloque no usa `skip`.
 *     ORDEN DE EJECUCIÓN: GO-1 (caso 9) corre DESPUÉS de M7 y parte de lo que deja su último caso (M3 a M7 arriba). GO-1 no depende de M2 a M7 ni ellas de GO-1; solo depende de B1 (las funciones) y de B4 (Mesa, Cuenta y CuentaItem), que son del Paquete 1.
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
/** Solo las siete de M4.5: las de M6.4 (y las que se sumen después) las da de alta otra migración. */
const CLAVES = clavesReservadasDe(M4_5);

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
    privilegiosDeColumna: await q(`SELECT table_name::text AS tabla, column_name::text AS columna, grantee::text AS rol, privilege_type FROM information_schema.column_privileges WHERE table_schema = 'public' AND grantee IN ('motor2_app', 'motor2_plataforma') AND (table_name LIKE 'FacturaProveedor%' OR table_name LIKE 'NotaCreditoProveedor%' OR table_name IN ('PuntoDeVentaDeProveedor', 'ConceptoDeGasto', 'ImputacionDeGasto', 'ReclasificacionRenglon', 'PlanDeCostos', 'CentroDeCostos', 'PlanDeCostosSucursal', 'DistribucionCostoVersion', 'DistribucionCostoLinea', 'GrupoDeOpciones', 'OpcionDeGrupo', 'VersionDeOpcion', 'ConsumoDeOpcion', 'ProductoAdmiteGrupo', 'ProductoAdmiteOpcion', 'PrecioLocalDeOpcion', 'OpcionApagadaEnSucursal', 'OpcionElegidaEnLinea', 'CuentaItem', 'Operacion')) ORDER BY 1, 2, 3, 4`),
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

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// PAQUETE 4, M6 (la nota de crédito de proveedor, M6.1 a M6.4): sigue en el MISMO archivo para reutilizar la base temporal, la foto del catálogo y los ayudantes, y parte del estado que dejó el último caso de M5 (todo arriba, con datos de humo).
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
const M6_1 = "20261018100000_nota_credito_proveedor";
const M6_2 = "20261018101000_rls_sucursal_nota_credito_proveedor_imputacion";
const M6_3 = "20261018102000_anulacion_coherente_admite_devolucion";
const M6_4 = "20261018103000_permisos_notas_de_credito";
const SUBIDA_M6 = [M6_1, M6_2, M6_3, M6_4];
/** La reversa va en orden inverso: las claves, el CHECK de `Operacion`, las políticas y las tablas. */
const BAJADA_M6 = [M6_4, M6_3, M6_2, M6_1];
const TABLAS_M6 = ["NotaCreditoProveedor", "NotaCreditoProveedorLinea", "NotaCreditoProveedorImputacion", "NotaCreditoProveedorTributo"];
const CLAVES_M6 = clavesReservadasDe(M6_4);
/** Las seis claves foráneas de TRES columnas de M6.1 (la nota es del proveedor de su factura; la línea, del tipo y de la factura de su nota, de un renglón de ESA factura y de su naturaleza; la imputación, de una línea que admite devolución). */
const FK_DE_TRES_COLUMNAS_M6 = [
  "NotaCreditoProveedor_factura_fkey", "NotaCreditoProveedorLinea_nota_tipo_fkey", "NotaCreditoProveedorLinea_nota_factura_fkey", "NotaCreditoProveedorLinea_renglon_factura_fkey", "NotaCreditoProveedorLinea_renglon_naturaleza_fkey",
  "NotaCreditoProveedorImputacion_linea_fkey",
];
const CHECKS_M6: Readonly<Record<string, readonly string[]>> = {
  NotaCreditoProveedor: ["anulacion_pareo", "condicion_iva_empresa", "desglose_dentro_del_total", "desglose_no_negativo", "desglose_pareo", "estado", "importe_total_positivo", "letra", "motivo", "motivo_anulacion", "nro", "origen", "tipo"],
  NotaCreditoProveedorLinea: ["admite_devolucion", "alicuota_iva", "alicuota_sin_iva", "desglose_no_negativo", "desglose_pareo", "importe_positivo", "iva_computable", "naturaleza", "neto_mas_iva", "orden", "pareo_suelta", "referencia", "tipo_de_costo", "tipo_nota"],
  NotaCreditoProveedorImputacion: ["cantidad_positiva", "devolucion", "importe_positivo", "iva_computable"],
  NotaCreditoProveedorTributo: ["importe_positivo", "tipo"],
};
const UNICOS_M6 = [
  "FacturaProveedor_empresaId_id_proveedorId_key", "FacturaProveedorRenglon_empresaId_facturaProveedorId_id_key",
  "NotaCreditoProveedor_claveIdempotencia_key", "NotaCreditoProveedor_empresaId_id_facturaProveedorId_key", "NotaCreditoProveedor_empresaId_id_key", "NotaCreditoProveedor_empresaId_id_tipo_key", "NotaCreditoProveedor_unica_vigente_key",
  "NotaCreditoProveedorImputacion_devolucion_key", "NotaCreditoProveedorImputacion_empresaId_id_key", "NotaCreditoProveedorImputacion_linea_sucursal_key",
  "NotaCreditoProveedorLinea_empresaId_id_admiteDevolucion_key", "NotaCreditoProveedorLinea_empresaId_id_key", "NotaCreditoProveedorLinea_notaCreditoProveedorId_orden_key", "NotaCreditoProveedorTributo_empresaId_id_key",
];
const COLUMNAS_ACTUALIZABLES_DE_LA_NOTA = ["anuladaEn", "anuladaPorId", "motivoAnulacion", "recibidaEnAdministracionEn"];

const insertarNotaDelHumo = (id: string, numero: string, extra: { proveedor?: string; tipo?: "SOBRE_FACTURA" | "SUELTA" } = {}) => {
  const sobreFactura = (extra.tipo ?? "SOBRE_FACTURA") === "SOBRE_FACTURA";
  return `INSERT INTO "NotaCreditoProveedor" ("id","proveedorId","tipo","facturaProveedorId","nroComprobante","nroComprobanteNormalizado","fecha","importeTotal","motivo","claveIdempotencia","payloadHash","resultadoMensaje","creadoPorId")
   VALUES ('${id}','${extra.proveedor ?? "prov_m4"}','${extra.tipo ?? "SOBRE_FACTURA"}',${sobreFactura ? "'fact_humo'" : "NULL"},'${numero}','${numero}','2026-09-10T15:00:00Z',100.00,'Rotura','clave_${id}','huella','Registrada.','u_m4')`;
};
const insertarLineaDelHumo = (id: string, nota: string, orden: number, extra: { renglon?: string; naturaleza?: string; tipoNota?: string } = {}) =>
  `INSERT INTO "NotaCreditoProveedorLinea" ("id","notaCreditoProveedorId","tipoNota","facturaProveedorId","orden","facturaProveedorRenglonId","naturaleza","admiteDevolucion","origenImporte","importe")
   VALUES ('${id}','${nota}','${extra.tipoNota ?? "SOBRE_FACTURA"}','fact_humo',${orden},'${extra.renglon ?? "ren_merc"}','${extra.naturaleza ?? "MERCADERIA"}',${(extra.naturaleza ?? "MERCADERIA") === "MERCADERIA"},'RENGLON',50.00)`;
const insertarImputacionDeLaNota = (id: string, linea: string, sucursal: string, devolucion?: string) =>
  `INSERT INTO "NotaCreditoProveedorImputacion" ("id","notaCreditoProveedorLineaId","lineaAdmiteDevolucion","sucursalId","importe"${devolucion ? ',"cantidadStock","operacionDevolucionId"' : ""}) VALUES ('${id}','${linea}',true,'${sucursal}',50.00${devolucion ? `,2,'${devolucion}'` : ""})`;
const insertarOperacionDelHumo = (id: string, proceso: string, extra = "", empresa?: string) =>
  `INSERT INTO "Operacion" (${empresa ? '"empresaId",' : ""}"id","sucursalId","fecha","usuarioId","proceso") VALUES (${empresa ? `'${empresa}',` : ""}'${id}','suc_a',now(),'u_m4','${proceso}')${extra}`;

/** Sacar, como dueño, todo lo que cuelga de las notas (hijas primero): sus claves foráneas son RESTRICT y frenarían el borrado de un renglón, de una factura o de una `Operacion`. */
const vaciarLasNotas = async () => {
  for (const tabla of ["NotaCreditoProveedorImputacion", "NotaCreditoProveedorTributo", "NotaCreditoProveedorLinea", "NotaCreditoProveedor"]) await base.cliente.query(`DELETE FROM "${tabla}"`);
};

/** Las comprobaciones de «M6 aplicada» (el humo corre en transacciones que se deshacen: no deja ninguna nota). */
async function comprobarArribaM6(etiqueta: string) {
  const f = await foto();
  const conNombre = (lista: Array<Record<string, unknown>>, campo: string) => lista.map((x) => String(x[campo]));

  // M6.1: las cuatro tablas con RLS sin FORCE, las columnas de dinero y las claves foráneas, los CHECK y los índices.
  for (const t of TABLAS_M6) expect(f.rls.find((r) => r.tabla === t), `${etiqueta}: ${t} con RLS y sin FORCE`).toEqual({ tabla: t, rls: true, forzado: false });
  expect(f.columnas.filter((c) => TABLAS_M6.includes(String(c.tabla)) && /double|real|money/.test(String(c.data_type))), `${etiqueta}: ninguna columna de punto flotante`).toEqual([]);
  expect(f.columnas.filter((c) => c.tabla === "NotaCreditoProveedorImputacion" && c.columna === "cantidadStock").map((c) => [c.numeric_precision, c.numeric_scale]), `${etiqueta}: la cantidad es NUMERIC(14,4)`).toEqual([[14, 4]]);
  for (const nombre of FK_DE_TRES_COLUMNAS_M6) {
    const r = f.restricciones.find((x) => x.nombre === nombre);
    expect(r, `${etiqueta}: existe la clave foránea ${nombre}`).toBeDefined();
    expect(String(r!.definicion), `${etiqueta}: ${nombre} con tres columnas, ON UPDATE y ON DELETE RESTRICT`).toMatch(/^FOREIGN KEY \(("[A-Za-z]+"|[a-z]+), ("[A-Za-z]+"|[a-z]+), ("[A-Za-z]+"|[a-z]+)\) .* ON UPDATE RESTRICT ON DELETE RESTRICT$/);
  }
  for (const tabla of TABLAS_M6) {
    const checks = f.restricciones.filter((r) => r.tabla === `"${tabla}"` && r.contype === "c");
    expect(conNombre(checks, "nombre").sort(), `${etiqueta}: los CHECK de ${tabla}`).toEqual(CHECKS_M6[tabla]!.map((c) => `${tabla}_${c}_chk`).sort());
    expect(checks.every((c) => c.convalidated), `${etiqueta}: los CHECK de ${tabla} validados`).toBe(true);
  }
  for (const nombre of UNICOS_M6) {
    const i = f.indices.find((x) => x.nombre === nombre);
    expect(i, `${etiqueta}: existe el índice único ${nombre}`).toBeDefined();
    expect(String(i!.indexdef), `${etiqueta}: ${nombre}`).toMatch(/^CREATE UNIQUE INDEX/);
  }
  expect(String(f.indices.find((x) => x.nombre === "NotaCreditoProveedor_unica_vigente_key")!.indexdef), `${etiqueta}: el único del número es PARCIAL (solo las vigentes) e incluye la letra`).toMatch(/COALESCE\(letra, ''::text\), "nroComprobanteNormalizado"\) WHERE \("anuladaEn" IS NULL\)$/);

  // M6.2: las cuatro políticas de sucursal de la imputación (y solo ella), las demás tablas de la nota con la política de empresa.
  for (const t of ["NotaCreditoProveedor", "NotaCreditoProveedorLinea", "NotaCreditoProveedorTributo"]) expect(f.politicas.filter((p) => p.tabla === t).map((p) => p.nombre), `${etiqueta}: ${t}, solo con la política de empresa`).toEqual(["aislamiento_empresa"]);
  const deAlcance = f.politicas.filter((p) => String(p.nombre).startsWith("alcance_sucursal_"));
  const deLaImputacion = deAlcance.filter((p) => p.tabla === "NotaCreditoProveedorImputacion");
  expect(f.politicas.filter((p) => p.tabla === "NotaCreditoProveedorImputacion"), `${etiqueta}: 5 políticas en la imputación (la de empresa y las 4 de sucursal)`).toHaveLength(5);
  expect(deLaImputacion.map((p) => p.cmd).sort(), `${etiqueta}: 4 políticas de sucursal en la imputación`).toEqual(["DELETE", "INSERT", "SELECT", "UPDATE"]);
  for (const p of deLaImputacion) expect([p.permissive, p.roles], `${etiqueta}: ${p.nombre} RESTRICTIVE para motor2_app`).toEqual(["RESTRICTIVE", "{motor2_app}"]);
  expect(deAlcance, `${etiqueta}: 128 del Paquete 1 + 4 de Venta + 4 de la parte + 4 de la imputación del gasto + 4 de la imputación de la nota`).toHaveLength(TABLAS_DEL_PAQUETE_1.length * COMANDOS_CON_POLITICA_DE_ALCANCE.length + 16);

  // Privilegios exactos: SELECT e INSERT en las cuatro; en la cabecera, UPDATE por columna solo de la anulación y la recepción; nada para motor2_plataforma.
  for (const t of TABLAS_M6) expect(f.privilegios.filter((p) => p.tabla === t), `${etiqueta}: ${t}: solo se agrega`).toEqual([{ tabla: t, rol: "motor2_app", privilege_type: "INSERT" }, { tabla: t, rol: "motor2_app", privilege_type: "SELECT" }]);
  expect(f.privilegiosDeColumna.filter((p) => String(p.tabla).startsWith("NotaCreditoProveedor") && p.privilege_type === "UPDATE").map((p) => `${p.tabla}.${p.columna}`).sort(), `${etiqueta}: UPDATE por columna, solo de la anulación y la recepción en la cabecera`).toEqual(
    COLUMNAS_ACTUALIZABLES_DE_LA_NOTA.map((c) => `NotaCreditoProveedor.${c}`).sort(),
  );

  // M6.3: el CHECK de Operacion admite anular una devolución a proveedor.
  const anulacion = f.restricciones.find((x) => x.nombre === "Operacion_anulacion_coherente_chk")!;
  expect([anulacion.contype, anulacion.convalidated], `${etiqueta}: la regla de anulación de Operacion, un CHECK validado`).toEqual(["c", true]);
  expect(String(anulacion.definicion), `${etiqueta}: la anulación admite DEVOLUCION_PROVEEDOR`).toContain("DEVOLUCION_PROVEEDOR");

  // M6.4: las tres claves, el admin con tres y nadie más.
  expect((await q<{ clave: string }>(`SELECT "clave" FROM "Accion" WHERE "clave" = ANY($1) ORDER BY 1`, [CLAVES_M6])).map((a) => a.clave), `${etiqueta}: las tres claves existen`).toEqual(CLAVES_M6);
  expect(await q(`SELECT DISTINCT "rolId" FROM "PermisoRol" WHERE "accionClave" = ANY($1) ORDER BY 1`, [CLAVES_M6]), `${etiqueta}: solo el admin tiene alguna`).toEqual([{ rolId: "rol_admin_m4" }]);
  expect(Number((await q<{ n: string }>(`SELECT count(*) AS n FROM "PermisoRol" WHERE "accionClave" = ANY($1)`, [CLAVES_M6]))[0]!.n), `${etiqueta}: tres filas del admin`).toBe(3);

  // Los datos del humo: se vuelven a sembrar como dueño (una reversa anterior pudo haberlos sacado), con las tablas de M6 y de M5 vacías primero (sus claves foráneas frenarían el borrado).
  const c = base.cliente;
  await vaciarLasNotas();
  for (const tabla of ["ReclasificacionRenglon", "ImputacionDeGasto", "FacturaProveedorRenglon", "FacturaProveedorSucursal", "FacturaProveedor", "ConceptoDeGasto"]) await c.query(`DELETE FROM "${tabla}"`);
  await c.query(`INSERT INTO "Proveedor" ("id","empresaId","codigo","nombre") VALUES ('prov_otro_m6',$1,'PRV_M6','Otro proveedor') ON CONFLICT ("id") DO NOTHING`, [E]);
  await c.query(insertarFactura("fact_humo", E));
  await c.query(insertarConcepto("con_humo", "ALQUILER", E));
  await c.query(insertarRenglonSinStock("ren_humo", "fact_humo", "con_humo", 1, E));
  await c.query(`INSERT INTO "FacturaProveedorRenglon" ("empresaId","id","facturaProveedorId","orden","naturaleza","productoId","cantidadStock","precioPorUnidadStock","detalle","precioTotal") VALUES ('${E}','ren_merc','fact_humo',2,'MERCADERIA','pro_m4',1,100,'1 kg',100.00)`);

  // Humo como el rol real de la app, con alcance en la sucursal A (todo dentro de una transacción que se deshace).
  app ??= await conectarComoApp();
  await app.query("BEGIN");
  try {
    await app.query("SELECT set_config('app.empresa_id', $1, true)", [E]);
    await app.query("SELECT set_config('app.sucursales_lectura', 'suc_a', true)");
    await app.query("SELECT set_config('app.sucursales_escritura', 'suc_a', true)");
    expect(await falla(app, insertarNotaDelHumo("nota_1", "0001-00000001")), `${etiqueta}: cargar una nota sobre la factura anda`).toBeNull();
    expect(await falla(app, insertarNotaDelHumo("nota_dup", "0001-00000001")), `${etiqueta}: repetir el número vigente da 23505`).toBe("23505");
    expect(await falla(app, insertarNotaDelHumo("nota_otro", "0001-00000002", { proveedor: "prov_otro_m6" })), `${etiqueta}: una nota de otro proveedor sobre la factura da 23503`).toBe("23503");
    expect(await falla(app, insertarLineaDelHumo("lin_1", "nota_1", 1)), `${etiqueta}: la línea de mercadería sobre el renglón anda`).toBeNull();
    expect(await falla(app, insertarLineaDelHumo("lin_sin_stock", "nota_1", 2, { renglon: "ren_humo" })), `${etiqueta}: mercadería sobre un renglón sin stock da 23503`).toBe("23503");
    expect(await falla(app, insertarLineaDelHumo("lin_suelta", "nota_1", 3, { tipoNota: "SUELTA" })), `${etiqueta}: una línea suelta en una nota con factura da 23514 (el CHECK de la referencia)`).toBe("23514");
    expect(await falla(app, insertarImputacionDeLaNota("imp_a", "lin_1", "suc_a")), `${etiqueta}: imputar en la propia sucursal anda`).toBeNull();
    expect(await falla(app, insertarImputacionDeLaNota("imp_b", "lin_1", "suc_b")), `${etiqueta}: imputar en otra sucursal da 42501`).toBe("42501");
    expect((await app.query(`SELECT id FROM "NotaCreditoProveedorImputacion"`)).rows, `${etiqueta}: con la sucursal A solo se ve su imputación`).toEqual([{ id: "imp_a" }]);
    expect(await falla(app, insertarOperacionDelHumo("dev_1", "DEVOLUCION_PROVEEDOR")), `${etiqueta}: una devolución a proveedor anda`).toBeNull();
    expect(await falla(app, `UPDATE "NotaCreditoProveedorImputacion" SET "operacionDevolucionId" = 'dev_1', "cantidadStock" = 2 WHERE id = 'imp_a'`), `${etiqueta}: la imputación no se actualiza (42501)`).toBe("42501");
    expect(await falla(app, insertarLineaDelHumo("lin_2", "nota_1", 4)), `${etiqueta}: una segunda línea anda`).toBeNull();
    expect(await falla(app, insertarImputacionDeLaNota("imp_dev", "lin_2", "suc_a", "dev_1")), `${etiqueta}: acreditar la devolución anda`).toBeNull();
    expect(await falla(app, insertarLineaDelHumo("lin_3", "nota_1", 5)), `${etiqueta}: una tercera línea anda`).toBeNull();
    expect(await falla(app, insertarImputacionDeLaNota("imp_dev2", "lin_3", "suc_a", "dev_1")), `${etiqueta}: acreditar la MISMA devolución dos veces da 23505`).toBe("23505");
    expect(await falla(app, `UPDATE "NotaCreditoProveedor" SET "importeTotal" = 1 WHERE id = 'nota_1'`), `${etiqueta}: UPDATE del importe da 42501`).toBe("42501");
    expect(await falla(app, `DELETE FROM "NotaCreditoProveedor" WHERE id = 'nota_1'`), `${etiqueta}: DELETE de la nota da 42501`).toBe("42501");
    expect(await falla(app, `UPDATE "FacturaProveedor" SET "proveedorId" = 'prov_otro_m6' WHERE id = 'fact_humo'`), `${etiqueta}: corregir el proveedor de una factura con notas da 23503`).toBe("23503");
    expect(await falla(app, `UPDATE "NotaCreditoProveedor" SET "anuladaEn" = now(), "anuladaPorId" = 'u_m4', "motivoAnulacion" = 'Cargada por error' WHERE id = 'nota_1' AND "anuladaEn" IS NULL`), `${etiqueta}: anular por columna anda`).toBeNull();
    expect(await falla(app, `UPDATE "Operacion" SET "anuladaEn" = now(), "anuladaPorId" = 'u_m4', "motivoAnulacion" = 'Cargada por error' WHERE id = 'dev_1'`), `${etiqueta}: anular la devolución anda (M6.3)`).toBeNull();
    expect(await falla(app, insertarOperacionDelHumo("ajuste_1", "AJUSTE", "; UPDATE \"Operacion\" SET \"anuladaEn\" = now() WHERE id = 'ajuste_1'")), `${etiqueta}: un AJUSTE sigue sin poder anularse (23514)`).toBe("23514");
  } finally {
    await app.query("ROLLBACK");
  }
  expect([Number((await q<{ n: string }>(`SELECT count(*) AS n FROM "NotaCreditoProveedor"`))[0]!.n), Number((await q<{ n: string }>(`SELECT count(*) AS n FROM "Operacion" WHERE id IN ('dev_1','ajuste_1')`))[0]!.n)], `${etiqueta}: el humo no dejó ninguna fila`).toEqual([0, 0]);
}

let antesDeM6: Awaited<ReturnType<typeof foto>>;
let arribaConM6: Awaited<ReturnType<typeof foto>>;

describe("M6: subir, bajar y subir (la nota de crédito de proveedor, M6.1 a M6.4) sobre el estado que deja M5 con todo arriba", () => {
  it("7.0. las cuatro migraciones existen, son posteriores a M5 y van en orden, avisan que requieren autorización y tienen down.sql; M6.1, M6.3 y M6.4 ABORTAN al bajar; solo M6.2 es de políticas de sucursal; M6.1, M6.3 y M6.4 no nombran políticas de alcance; M6.3 no tiene bloques DO", () => {
    expect([...SUBIDA_M6].sort()).toEqual(SUBIDA_M6);
    for (const m of SUBIDA_M6) {
      expect(m > M5, `${m} es posterior a M5`).toBe(true);
      expect(sql(m, "migration.sql").split("\n")[0], `${m}: avisa que requiere autorización`).toContain("REQUIERE AUTORIZACIÓN EXPRESA");
      expect(sql(m, "down.sql").length, `${m}: tiene down.sql`).toBeGreaterThan(0);
    }
    for (const m of [M6_1, M6_3, M6_4]) expect(sql(m, "down.sql"), `${m}: la reversa ABORTA con datos`).toMatch(/ABORTA/);
    expect(MIGRACIONES_DE_POLITICAS_POSTERIORES.map((g) => g.migracion)).toContain(M6_2);
    for (const m of [M6_1, M6_3, M6_4]) {
      expect(MIGRACIONES_DE_POLITICAS_POSTERIORES.map((g) => g.migracion), `${m} no es de políticas`).not.toContain(m);
      for (const archivo of ["migration.sql", "down.sql"] as const) {
        if (!(archivo === "down.sql" && m === M6_2)) {
          expect(sql(m, archivo), `${m}/${archivo} no nombra políticas de alcance de sucursal`).not.toContain("alcance_sucursal_");
          expect(sql(m, archivo), `${m}/${archivo} no nombra el ayudante de alcance`).not.toContain("app_sucursales_");
        }
      }
    }
    expect(MIGRACIONES_DE_POLITICAS_DE_SUCURSAL.map((g) => g.migracion)).not.toContain(M6_2);
    expect(TABLAS_DEL_PAQUETE_1).not.toContain("NotaCreditoProveedorImputacion");
    expect(sql(M6_3, "migration.sql"), "reglas-operacion-movimiento parte el archivo por ';\\n': sin bloques DO").not.toMatch(/\bDO\s+\$\$/);
  });

  it("7.1. SUBIR: M6.1 a M6.4 sobre M5 con todo arriba dejan las cuatro tablas, las claves foráneas, los CHECK, los índices, las políticas (1, 1, 5 y 1; el total de alcance pasa a +16), los privilegios exactos, el CHECK de Operacion y las tres claves, y andan como motor2_app", async (ctx) => {
    if (!hayRol) return ctx.skip();
    antesDeM6 = await foto();
    for (const t of TABLAS_M6) expect(antesDeM6.rls.find((r) => r.tabla === t), `antes de M6 ${t} no existe`).toBeUndefined();
    expect(String(antesDeM6.restricciones.find((x) => x.nombre === "Operacion_anulacion_coherente_chk")!.definicion), "antes de M6 la anulación solo admite VENTA y COMPRA").not.toContain("DEVOLUCION_PROVEEDOR");
    for (const m of SUBIDA_M6) await correr(m, "migration.sql");
    await comprobarArribaM6("primera subida de M6");
    arribaConM6 = await foto();
  });

  it("7.2. BAJAR CON DATOS: las reversas de M6.4, M6.3 y M6.1 ABORTAN cada una por su motivo sin dejar nada a medias; con M6.1 arriba las reversas de M4.2, M4.1 y M3b FALLAN con 2BP01 sin dejar nada a medias; sin filas M6.4 a M6.1 dejan el catálogo como antes de M6", async (ctx) => {
    if (!hayRol) return ctx.skip();
    const c = base.cliente;
    // Datos que solo existen por M6 (escritos por el dueño): una nota con su línea y su imputación, una devolución ANULADA y una clave configurada a mano.
    await c.query(insertarOperacionDelHumo("dev_m6", "DEVOLUCION_PROVEEDOR", "", E));
    await c.query(`UPDATE "Operacion" SET "anuladaEn" = now(), "anuladaPorId" = 'u_m4' WHERE id = 'dev_m6'`);
    await c.query(insertarNotaDelHumo("nota_m6", "0001-00000009").replace('INSERT INTO "NotaCreditoProveedor" (', `INSERT INTO "NotaCreditoProveedor" ("empresaId",`).replace("VALUES (", `VALUES ('${E}',`));
    await c.query(insertarLineaDelHumo("lin_m6", "nota_m6", 1).replace('INSERT INTO "NotaCreditoProveedorLinea" (', `INSERT INTO "NotaCreditoProveedorLinea" ("empresaId",`).replace("VALUES (", `VALUES ('${E}',`));
    await c.query(insertarImputacionDeLaNota("imp_m6", "lin_m6", "suc_a", "dev_m6").replace('INSERT INTO "NotaCreditoProveedorImputacion" (', `INSERT INTO "NotaCreditoProveedorImputacion" ("empresaId",`).replace("VALUES (", `VALUES ('${E}',`));
    await c.query(`UPDATE "PermisoRol" SET "puedeEditar" = false WHERE "rolId" = 'rol_admin_m4' AND "accionClave" = 'gasto_nota_credito'`);

    // 1) Cada reversa ABORTA por su motivo y no deja nada a medias.
    await expect(correr(M6_4, "down.sql")).rejects.toThrow(/No se puede bajar M6\.4: hay 1 fila/);
    await expect(correr(M6_3, "down.sql")).rejects.toThrow(/No se puede bajar M6\.3: hay 1 devolución/);
    await expect(correr(M6_1, "down.sql")).rejects.toThrow(/No se puede bajar M6\.1: la tabla \S+ tiene 1 fila/);
    const sinTocar = await foto();
    for (const k of Object.keys(arribaConM6) as (keyof typeof arribaConM6)[]) expect(sinTocar[k], `el aborto no deja nada a medias («${k}»)`).toEqual(arribaConM6[k]);
    expect(Number((await q<{ n: string }>(`SELECT count(*) AS n FROM "NotaCreditoProveedorImputacion"`))[0]!.n), "la imputación sigue").toBe(1);
    expect(Number((await q<{ n: string }>(`SELECT count(*) AS n FROM "Accion" WHERE "clave" = ANY($1)`, [CLAVES_M6]))[0]!.n), "las tres claves siguen").toBe(3);

    // 2) Se saca lo escrito a mano y se baja lo de antes de M6 que M6 no bloquea (M5, M4.5, M4.4 y M4.3), sin gastos cargados, para que la que frene las reversas de M4.2, M4.1 y M3b sea la dependencia de M6.1 y no una guarda de datos.
    await c.query(`UPDATE "PermisoRol" SET "puedeEditar" = true WHERE "rolId" = 'rol_admin_m4' AND "accionClave" = 'gasto_nota_credito'`);
    await vaciarLasNotas();
    await c.query(`DELETE FROM "Operacion" WHERE id = 'dev_m6'`);
    await c.query(`DELETE FROM "ImputacionDeGasto"`);
    await c.query(`DELETE FROM "FacturaProveedorRenglon" WHERE "naturaleza" = 'SIN_STOCK'`);
    for (const m of [M5, M4_5, M4_4, M4_3]) await correr(m, "down.sql");
    const bloqueada = await foto();
    const dependencia = async (m: string, dependiente: string) => {
      const error = await correr(m, "down.sql").then(() => null, (e: unknown) => e as { code?: string; detail?: string });
      expect(error?.code, `con M6.1 arriba la reversa de ${m} falla por dependencia`).toBe("2BP01");
      expect(error?.detail, `${m}: el dependiente es de M6.1`).toContain(dependiente);
    };
    await dependencia(M4_2, "NotaCreditoProveedorLinea_renglon_naturaleza_fkey");
    await dependencia(M4_1, "NotaCreditoProveedorLinea_empresaId_conceptoGastoId_fkey");
    await dependencia(M3[1]!, "NotaCreditoProveedorLinea");
    const intacta = await foto();
    for (const k of Object.keys(bloqueada) as (keyof typeof bloqueada)[]) expect(intacta[k], `las reversas bloqueadas no dejan nada a medias («${k}»)`).toEqual(bloqueada[k]);
    // Se vuelve a subir lo que se bajó (M4.3, M4.4, M4.5 y M5): el catálogo es otra vez el de M6 arriba.
    for (const m of [M4_3, M4_4, M4_5, M5]) await correr(m, "migration.sql");
    const restaurada = await foto();
    for (const k of Object.keys(arribaConM6) as (keyof typeof arribaConM6)[]) expect(restaurada[k], `catálogo «${k}» igual que con M6 arriba`).toEqual(arribaConM6[k]);

    // 3) Sin filas ni configuración a mano, M6.4 a M6.1 pasan y el catálogo queda IDÉNTICO al de antes de M6.
    for (const m of BAJADA_M6) await correr(m, "down.sql");
    const despues = await foto();
    for (const k of Object.keys(antesDeM6) as (keyof typeof antesDeM6)[]) expect(despues[k], `catálogo «${k}» igual que antes de M6`).toEqual(antesDeM6[k]);
    for (const t of TABLAS_M6) expect(await q(`SELECT 1 FROM pg_class WHERE relname = '${t}' AND relnamespace = 'public'::regnamespace`), `sin la tabla ${t}`).toEqual([]);
    expect(await q(`SELECT 1 FROM "Accion" WHERE "clave" = ANY($1)`, [CLAVES_M6]), "sin las tres claves").toEqual([]);
  });

  it("7.3. SUBIR OTRA VEZ: las mismas comprobaciones y el catálogo es idéntico al de la primera subida", async (ctx) => {
    if (!hayRol) return ctx.skip();
    for (const m of SUBIDA_M6) await correr(m, "migration.sql");
    for (const t of TABLAS_M6) expect(Number((await q<{ n: string }>(`SELECT count(*) AS n FROM "${t}"`))[0]!.n), `${t} volvió vacía`).toBe(0);
    await comprobarArribaM6("segunda subida de M6");
    const otraVez = await foto();
    for (const k of Object.keys(arribaConM6) as (keyof typeof arribaConM6)[]) expect(otraVez[k], `catálogo «${k}» igual que la primera vez`).toEqual(arribaConM6[k]);
  });

  it("7.4. EL CICLO COMPLETO: se baja M6, M5, M4.5 a M4.1 y M3e a M3a hasta el Paquete 2 (catálogo idéntico al de entonces) y se sube todo otra vez (M3, M4, M5 y M6) hasta el mismo catálogo con M6 arriba", async (ctx) => {
    if (!hayRol) return ctx.skip();
    // Sin notas ni gastos cargados: la reversa de M6.1 y la de M4.2 abortan si los hay, y borrar un renglón con líneas de nota choca con RESTRICT.
    await vaciarLasNotas();
    for (const tabla of ["ReclasificacionRenglon", "ImputacionDeGasto"]) await base.cliente.query(`DELETE FROM "${tabla}"`);
    await base.cliente.query(`DELETE FROM "FacturaProveedorRenglon" WHERE "naturaleza" = 'SIN_STOCK'`);
    for (const m of [...BAJADA_M6, M5, ...BAJADA]) await correr(m, "down.sql");
    for (const m of [...M3].reverse()) await correr(m, "down.sql");
    const abajo = await foto();
    for (const k of Object.keys(antesDeM3) as (keyof typeof antesDeM3)[]) expect(abajo[k], `catálogo «${k}» igual que antes de M3`).toEqual(antesDeM3[k]);
    for (const m of [...M3, ...SUBIDA, M5]) await correr(m, "migration.sql");
    await comprobarArribaM5("ciclo completo, M5");
    for (const m of SUBIDA_M6) await correr(m, "migration.sql");
    await comprobarArribaM6("ciclo completo, M6");
    const otraVez = await foto();
    for (const k of Object.keys(arribaConM6) as (keyof typeof arribaConM6)[]) expect(otraVez[k], `catálogo «${k}» igual que la primera vez`).toEqual(arribaConM6[k]);
  });

  it("7.5. Las cuatro reversas son idempotentes (IF EXISTS): bajar dos veces cada una no falla, deja el catálogo de antes de M6, y volver a subir deja todo arriba", async (ctx) => {
    if (!hayRol) return ctx.skip();
    await vaciarLasNotas();
    for (const m of BAJADA_M6) {
      await correr(m, "down.sql");
      await correr(m, "down.sql");
    }
    const abajo = await foto();
    for (const k of Object.keys(antesDeM6) as (keyof typeof antesDeM6)[]) expect(abajo[k], `catálogo «${k}» igual que antes de M6`).toEqual(antesDeM6[k]);
    for (const m of SUBIDA_M6) await correr(m, "migration.sql");
    await comprobarArribaM6("tercera subida de M6");
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// PAQUETE 5, M7 (CENTROS DE COSTOS: M7.1 a M7.4): sigue en el MISMO archivo para reutilizar la base temporal, la foto del catálogo y los ayudantes, y parte del estado que dejó el último caso de M6 (M3 a M6 arriba, con datos de humo). Corre DESPUÉS de M6 y es independiente de él: M7 no toca ninguna tabla de M6, pero con las de M6 arriba hay que vaciar las notas antes de tocar los gastos y bajar M6 antes que M5 y M4.x.
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
const M7_1 = "20261019100000_planes_y_centros_de_costos";
const M7_2 = "20261019101000_distribucion_de_costos";
const M7_3 = "20261019102000_rls_sucursal_centros_de_costos";
const M7_4 = "20261019103000_permisos_centros_de_costos";
const M7 = [M7_1, M7_2, M7_3, M7_4];
/** La reversa va en orden inverso: las claves, las políticas, la distribución y el catálogo. */
const BAJADA_M7 = [M7_4, M7_3, M7_2, M7_1];
const TABLAS_M7 = ["PlanDeCostos", "CentroDeCostos", "PlanDeCostosSucursal", "DistribucionCostoVersion", "DistribucionCostoLinea"];
const CLAVES_M7 = clavesReservadasDe(M7_4);
const CHECKS_M7 = [
  "CentroDeCostos_codigo_chk", "CentroDeCostos_nombre_chk", "CentroDeCostos_sin_padre_chk", "DistribucionCostoLinea_importe_chk", "DistribucionCostoLinea_iva_computable_chk", "DistribucionCostoLinea_porcentaje_chk",
  "DistribucionCostoVersion_motivo_chk", "DistribucionCostoVersion_motivo_en_correccion_chk", "DistribucionCostoVersion_numero_chk", "PlanDeCostos_codigo_chk", "PlanDeCostos_nombre_chk",
];
const CLAVES_FORANEAS_M7 = [
  "CentroDeCostos_empresaId_fkey", "CentroDeCostos_empresaId_planDeCostosId_centroPadreId_fkey", "CentroDeCostos_empresaId_planDeCostosId_fkey", "DistribucionCostoLinea_empresaId_distribucionCostoVersionI_fkey",
  "DistribucionCostoLinea_empresaId_fkey", "DistribucionCostoLinea_empresaId_planDeCostosId_centroDeCo_fkey", "DistribucionCostoVersion_creadoPorId_fkey", "DistribucionCostoVersion_empresaId_fkey",
  "DistribucionCostoVersion_empresaId_imputacionDeGastoId_fkey", "DistribucionCostoVersion_empresaId_planDeCostosId_fkey", "PlanDeCostos_empresaId_fkey", "PlanDeCostosSucursal_empresaId_fkey",
  "PlanDeCostosSucursal_empresaId_planDeCostosId_fkey", "PlanDeCostosSucursal_empresaId_sucursalId_fkey",
];
const UNICOS_M7 = [
  "CentroDeCostos_empresaId_codigo_key", "CentroDeCostos_empresaId_id_key", "CentroDeCostos_empresaId_planDeCostosId_id_key", "CentroDeCostos_empresaId_planDeCostosId_nombre_key", "CentroDeCostos_nombre_lower_key",
  "DistribucionCostoLinea_empresaId_id_key", "DistribucionCostoLinea_version_centro_key", "DistribucionCostoVersion_claveIdempotencia_key", "DistribucionCostoVersion_empresaId_id_key",
  "DistribucionCostoVersion_empresaId_id_planDeCostosId_key", "DistribucionCostoVersion_imputacion_plan_numero_key", "PlanDeCostos_empresaId_codigo_key", "PlanDeCostos_empresaId_id_key",
  "PlanDeCostos_empresaId_nombre_key", "PlanDeCostos_nombre_lower_key", "PlanDeCostosSucursal_empresaId_id_key", "PlanDeCostosSucursal_planDeCostosId_sucursalId_key",
];

/** Vacía las tablas de M7 (como dueño, en el orden de sus claves foráneas). Solo si ya están arriba. */
async function vaciarTablasDeM7() {
  for (const t of ["DistribucionCostoLinea", "DistribucionCostoVersion", "PlanDeCostosSucursal", "CentroDeCostos", "PlanDeCostos"]) await base.cliente.query(`DELETE FROM "${t}"`);
}

/** Los gastos de la sección: la factura, el concepto, un renglón sin stock imputado a las dos sucursales (120,00 y 80,00), sembrados como dueño. Antes se vacían las tablas de M7, las notas de crédito de M6 y las de M5 (referencian a los renglones y a las imputaciones). */
async function sembrarGastosParaM7() {
  const c = base.cliente;
  await vaciarTablasDeM7();
  await vaciarLasNotas();
  for (const tabla of ["ReclasificacionRenglon", "ImputacionDeGasto", "FacturaProveedorRenglon", "FacturaProveedorSucursal", "FacturaProveedor", "ConceptoDeGasto"]) await c.query(`DELETE FROM "${tabla}"`);
  await c.query(insertarFactura("fact_humo", E));
  await c.query(insertarConcepto("con_humo", "ALQUILER", E));
  await c.query(insertarRenglonSinStock("ren_humo", "fact_humo", "con_humo", 1, E));
  await c.query(insertarImputacion("imp_a", "ren_humo", "suc_a", E, "120.00"));
  await c.query(insertarImputacion("imp_b", "ren_humo", "suc_b", E, "80.00"));
}

/** Plan, dos centros (uno por plan), aplicabilidad en A y una distribución de la imputación A (versión 1, un centro al 100 %), sembrados como dueño: lo que una reversa con datos tiene que respetar. */
async function sembrarCentrosParaM7() {
  const c = base.cliente;
  await c.query(`INSERT INTO "PlanDeCostos" ("empresaId","id","codigo","nombre") VALUES ('${E}','plan_1','PLAN_UN','Unidades de negocio'), ('${E}','plan_2','PLAN_ZONA','Zonas')`);
  await c.query(`INSERT INTO "CentroDeCostos" ("empresaId","id","planDeCostosId","codigo","nombre") VALUES ('${E}','cen_1','plan_1','UN_A','Unidad A'), ('${E}','cen_2','plan_2','ZONA_N','Zona norte')`);
  await c.query(`INSERT INTO "PlanDeCostosSucursal" ("empresaId","id","planDeCostosId","sucursalId","aplica") VALUES ('${E}','apl_1','plan_1','suc_a',true)`);
  await c.query(
    `INSERT INTO "DistribucionCostoVersion" ("empresaId","id","imputacionDeGastoId","planDeCostosId","numero","claveIdempotencia","payloadHash","resultadoMensaje","creadoPorId") VALUES ('${E}','ver_1','imp_a','plan_1',1,'clave_ver_1','huella','Distribuido.','u_m4')`,
  );
  await c.query(`INSERT INTO "DistribucionCostoLinea" ("empresaId","id","distribucionCostoVersionId","planDeCostosId","centroDeCostosId","porcentajeBp","importe","importeIvaComputable") VALUES ('${E}','lin_1','ver_1','plan_1','cen_1',10000,120.00,0)`);
}

/** Las comprobaciones de «M7 aplicada» (el humo corre en transacciones que se deshacen: no deja ninguna fila de M7). */
async function comprobarArribaM7(etiqueta: string) {
  const f = await foto();
  const deLaTabla = (t: string) => f.restricciones.filter((r) => r.tabla === `"${t}"`);
  for (const t of TABLAS_M7) expect(f.rls.find((r) => r.tabla === t), `${etiqueta}: ${t} con RLS y sin FORCE`).toEqual({ tabla: t, rls: true, forzado: false });
  const checks = TABLAS_M7.flatMap((t) => deLaTabla(t).filter((r) => r.contype === "c"));
  expect(checks.map((r) => r.nombre).sort(), `${etiqueta}: los CHECK`).toEqual([...CHECKS_M7].sort());
  expect(checks.every((r) => r.convalidated), `${etiqueta}: los CHECK validados`).toBe(true);
  expect(TABLAS_M7.flatMap((t) => deLaTabla(t).filter((r) => r.contype === "f")).map((r) => r.nombre).sort(), `${etiqueta}: las claves foráneas`).toEqual([...CLAVES_FORANEAS_M7].sort());
  const def = (nombre: string) => String(f.restricciones.find((r) => r.nombre === nombre)!.definicion);
  expect(def("CentroDeCostos_empresaId_planDeCostosId_centroPadreId_fkey"), `${etiqueta}: el padre del centro es del mismo plan`).toBe(
    'FOREIGN KEY ("empresaId", "planDeCostosId", "centroPadreId") REFERENCES "CentroDeCostos"("empresaId", "planDeCostosId", id) ON UPDATE RESTRICT ON DELETE RESTRICT',
  );
  expect(def("DistribucionCostoLinea_empresaId_distribucionCostoVersionI_fkey"), `${etiqueta}: la línea es del plan de su versión`).toBe(
    'FOREIGN KEY ("empresaId", "distribucionCostoVersionId", "planDeCostosId") REFERENCES "DistribucionCostoVersion"("empresaId", id, "planDeCostosId") ON UPDATE RESTRICT ON DELETE RESTRICT',
  );
  expect(def("DistribucionCostoLinea_empresaId_planDeCostosId_centroDeCo_fkey"), `${etiqueta}: el centro de la línea es del plan de la versión`).toBe(
    'FOREIGN KEY ("empresaId", "planDeCostosId", "centroDeCostosId") REFERENCES "CentroDeCostos"("empresaId", "planDeCostosId", id) ON UPDATE RESTRICT ON DELETE RESTRICT',
  );
  const unicos = f.indices.filter((i) => TABLAS_M7.includes(String(i.tabla)) && String(i.indexdef).startsWith("CREATE UNIQUE INDEX") && !String(i.nombre).endsWith("_pkey"));
  expect(unicos.map((i) => i.nombre).sort(), `${etiqueta}: los índices únicos`).toEqual([...UNICOS_M7].sort());
  expect(String(f.indices.find((i) => i.nombre === "PlanDeCostos_nombre_lower_key")!.indexdef), `${etiqueta}: el nombre del plan es único sin importar mayúsculas`).toMatch(/lower\(nombre\)/);

  // Políticas: plan y centro solo con la de empresa; las otras tres, con la de empresa y las cuatro de sucursal; en total, las del Paquete 1, las de Venta, la parte y la imputación (12), la imputación de la nota de crédito de M6 (4) y las 12 de M7.
  for (const t of ["PlanDeCostos", "CentroDeCostos"]) expect(f.politicas.filter((p) => p.tabla === t).map((p) => p.nombre), `${etiqueta}: ${t} solo con la política de empresa`).toEqual(["aislamiento_empresa"]);
  for (const t of ["PlanDeCostosSucursal", "DistribucionCostoVersion", "DistribucionCostoLinea"]) {
    const de = f.politicas.filter((p) => p.tabla === t);
    expect(de.map((p) => p.nombre), `${etiqueta}: ${t}`).toEqual(["alcance_sucursal_delete", "alcance_sucursal_insert", "alcance_sucursal_select", "alcance_sucursal_update", "aislamiento_empresa"].sort());
    for (const p of de.filter((x) => String(x.nombre).startsWith("alcance_sucursal_"))) expect([p.permissive, p.roles], `${etiqueta}: ${t}.${p.nombre}`).toEqual(["RESTRICTIVE", "{motor2_app}"]);
  }
  expect(f.politicas.filter((p) => String(p.nombre).startsWith("alcance_sucursal_")), `${etiqueta}: 128 del Paquete 1 + 12 de Venta, la parte y la imputación + 4 de la imputación de la nota (M6) + 12 de M7`).toHaveLength(TABLAS_DEL_PAQUETE_1.length * COMANDOS_CON_POLITICA_DE_ALCANCE.length + 28);

  // Privilegios exactos: solo se agrega, salvo UPDATE por columna de nombre/activo (plan y centro) y de aplica; nada para motor2_plataforma ni DELETE.
  for (const t of TABLAS_M7) expect(f.privilegios.filter((p) => p.tabla === t), `${etiqueta}: ${t}: solo se agrega`).toEqual([{ tabla: t, rol: "motor2_app", privilege_type: "INSERT" }, { tabla: t, rol: "motor2_app", privilege_type: "SELECT" }]);
  const conUpdate = (t: string) => f.privilegiosDeColumna.filter((p) => p.tabla === t && p.privilege_type === "UPDATE" && p.rol === "motor2_app").map((p) => p.columna).sort();
  expect(conUpdate("PlanDeCostos"), `${etiqueta}: UPDATE del plan, solo nombre y activo`).toEqual(["activo", "nombre"]);
  expect(conUpdate("CentroDeCostos"), `${etiqueta}: UPDATE del centro, solo nombre y activo`).toEqual(["activo", "nombre"]);
  expect(conUpdate("PlanDeCostosSucursal"), `${etiqueta}: UPDATE de la aplicabilidad, solo aplica`).toEqual(["aplica"]);
  expect(conUpdate("DistribucionCostoVersion"), `${etiqueta}: la versión no se actualiza`).toEqual([]);
  expect(conUpdate("DistribucionCostoLinea"), `${etiqueta}: la línea no se actualiza`).toEqual([]);

  // M7.4: las tres claves, solo del admin.
  expect((await q<{ clave: string }>(`SELECT "clave" FROM "Accion" WHERE "clave" = ANY($1) ORDER BY 1`, [CLAVES_M7])).map((a) => a.clave), `${etiqueta}: las tres claves existen`).toEqual(CLAVES_M7);
  expect(await q(`SELECT DISTINCT "rolId" FROM "PermisoRol" WHERE "accionClave" = ANY($1) ORDER BY 1`, [CLAVES_M7]), `${etiqueta}: solo el admin tiene alguna`).toEqual([{ rolId: "rol_admin_m4" }]);
  expect(Number((await q<{ n: string }>(`SELECT count(*) AS n FROM "PermisoRol" WHERE "accionClave" = ANY($1)`, [CLAVES_M7]))[0]!.n), `${etiqueta}: tres filas del admin`).toBe(3);

  // Humo como el rol real de la app (todo dentro de una transacción que se deshace).
  await sembrarGastosParaM7();
  await base.cliente.query(`INSERT INTO "PlanDeCostos" ("empresaId","id","codigo","nombre") VALUES ('${E}','plan_humo','PLAN_HUMO','Plan del humo')`);
  await base.cliente.query(`INSERT INTO "CentroDeCostos" ("empresaId","id","planDeCostosId","codigo","nombre") VALUES ('${E}','cen_humo','plan_humo','UN_HUMO','Unidad del humo'), ('${E}','cen_otro','plan_humo','UN_OTRO','Otra unidad')`);
  await base.cliente.query(`INSERT INTO "PlanDeCostos" ("empresaId","id","codigo","nombre") VALUES ('${E}','plan_ajeno','PLAN_AJENO','Plan ajeno')`);
  await base.cliente.query(`INSERT INTO "CentroDeCostos" ("empresaId","id","planDeCostosId","codigo","nombre") VALUES ('${E}','cen_ajeno','plan_ajeno','UN_AJENO','Unidad ajena')`);
  app ??= await conectarComoApp();
  const humo = async (alcance: { lectura?: string; escritura?: string }, fn: (c: Client) => Promise<void>) => {
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
  const version = (id: string, imputacion: string, plan: string, numero: number, motivo: string | null) =>
    `INSERT INTO "DistribucionCostoVersion" ("id","imputacionDeGastoId","planDeCostosId","numero","motivo","claveIdempotencia","payloadHash","resultadoMensaje","creadoPorId") VALUES ('${id}','${imputacion}','${plan}',${numero},${motivo ? `'${motivo}'` : "NULL"},'clave_${id}','huella','Distribuido.','u_m4')`;
  const linea = (id: string, version: string, plan: string, centro: string, bp = 10000) =>
    `INSERT INTO "DistribucionCostoLinea" ("id","distribucionCostoVersionId","planDeCostosId","centroDeCostosId","porcentajeBp","importe","importeIvaComputable") VALUES ('${id}','${version}','${plan}','${centro}',${bp},1.00,0)`;
  await humo({}, async (c) => {
    expect((await c.query(`SELECT id FROM "PlanDeCostos" ORDER BY id`)).rows.map((r) => r.id), `${etiqueta}: los planes (de empresa) se ven aun sin alcance`).toEqual(["plan_ajeno", "plan_humo"]);
    expect(await falla(c, `INSERT INTO "PlanDeCostos" ("id","codigo","nombre") VALUES ('plan_sin_alcance','SIN_ALCANCE','Se escribe sin alcance')`), `${etiqueta}: dar de alta un plan no necesita alcance de sucursal`).toBeNull();
    expect((await c.query(`SELECT id FROM "DistribucionCostoVersion"`)).rows, `${etiqueta}: sin alcance no se ve ninguna distribución (falla cerrado)`).toEqual([]);
    expect(await falla(c, version("ver_sin_alcance", "imp_a", "plan_humo", 1, null)), `${etiqueta}: sin alcance de escritura una versión da 42501`).toBe("42501");
  });
  await humo({ lectura: "suc_a", escritura: "suc_a" }, async (c) => {
    expect(await falla(c, `INSERT INTO "PlanDeCostos" ("id","codigo","nombre") VALUES ('plan_nuevo','NUEVO','Nuevo')`), `${etiqueta}: dar de alta un plan anda`).toBeNull();
    expect(await falla(c, `INSERT INTO "PlanDeCostos" ("id","codigo","nombre") VALUES ('plan_dup','NUEVO','Otro nombre')`), `${etiqueta}: el código repetido da 23505`).toBe("23505");
    expect(await falla(c, `INSERT INTO "PlanDeCostos" ("id","codigo","nombre") VALUES ('plan_may','MAYUS','NUEVO')`), `${etiqueta}: el nombre repetido con otras mayúsculas da 23505`).toBe("23505");
    expect(await falla(c, `UPDATE "PlanDeCostos" SET "codigo" = 'OTRO' WHERE id = 'plan_humo'`), `${etiqueta}: UPDATE del código da 42501`).toBe("42501");
    expect(await falla(c, `UPDATE "PlanDeCostos" SET "nombre" = 'Renombrado', "activo" = false WHERE id = 'plan_humo'`), `${etiqueta}: renombrar y desactivar anda`).toBeNull();
    expect(await falla(c, `DELETE FROM "PlanDeCostos" WHERE id = 'plan_humo'`), `${etiqueta}: DELETE del plan da 42501`).toBe("42501");
    expect(await falla(c, `INSERT INTO "CentroDeCostos" ("id","planDeCostosId","codigo","nombre","centroPadreId") VALUES ('cen_hijo','plan_humo','HIJO','Hijo','cen_humo')`), `${etiqueta}: un centro con padre da 23514 (v1)`).toBe("23514");
    expect(await falla(c, `INSERT INTO "PlanDeCostosSucursal" ("id","planDeCostosId","sucursalId","aplica") VALUES ('apl_a','plan_humo','suc_a',true)`), `${etiqueta}: la aplicabilidad de la propia sucursal anda`).toBeNull();
    expect(await falla(c, `INSERT INTO "PlanDeCostosSucursal" ("id","planDeCostosId","sucursalId","aplica") VALUES ('apl_b','plan_humo','suc_b',true)`), `${etiqueta}: la de otra sucursal da 42501`).toBe("42501");
    expect(await falla(c, version("ver_a", "imp_a", "plan_humo", 1, null)), `${etiqueta}: una versión de la imputación de la propia sucursal anda`).toBeNull();
    expect(await falla(c, linea("lin_a", "ver_a", "plan_humo", "cen_humo")), `${etiqueta}: su línea anda`).toBeNull();
    expect(await falla(c, linea("lin_otro_plan", "ver_a", "plan_humo", "cen_ajeno")), `${etiqueta}: una línea con un centro de otro plan da 23503`).toBe("23503");
    expect(await falla(c, version("ver_b", "imp_b", "plan_humo", 1, null)), `${etiqueta}: una versión de la imputación de otra sucursal da 42501`).toBe("42501");
    expect(await falla(c, version("ver_a2", "imp_a", "plan_humo", 2, null)), `${etiqueta}: la versión 2 sin motivo da 23514`).toBe("23514");
    expect(await falla(c, version("ver_a3", "imp_a", "plan_humo", 1, null)), `${etiqueta}: repetir (imputación, plan, número) da 23505`).toBe("23505");
    expect(await falla(c, `UPDATE "DistribucionCostoVersion" SET "motivo" = 'otro' WHERE id = 'ver_a'`), `${etiqueta}: UPDATE de la versión da 42501`).toBe("42501");
    expect(await falla(c, `DELETE FROM "DistribucionCostoLinea" WHERE id = 'lin_a'`), `${etiqueta}: DELETE de la línea da 42501`).toBe("42501");
  });
  expect(await q(`SELECT 1 FROM "DistribucionCostoVersion"`), `${etiqueta}: el humo no dejó ninguna versión`).toEqual([]);
  await vaciarTablasDeM7();
}

let antesDeM7: Awaited<ReturnType<typeof foto>>;
let arribaConM7: Awaited<ReturnType<typeof foto>>;

describe("M7: subir, bajar y subir (centros de costos: M7.1 a M7.4) sobre el estado que deja M6 con todo arriba", () => {
  it("8.0. las cuatro migraciones existen, son posteriores a M6, van en este orden, avisan que requieren autorización, tienen down.sql (el de M7.1, M7.2 y M7.4 ABORTA), solo M7.3 es de políticas de sucursal y las otras no nombran políticas de alcance", () => {
    expect([...M7].sort()).toEqual(M7);
    for (const m of M7) {
      expect(m > M6_4, `${m} es posterior a M6`).toBe(true);
      expect(sql(m, "migration.sql").split("\n")[0], `${m}: avisa que requiere autorización`).toContain("REQUIERE AUTORIZACIÓN EXPRESA");
      expect(sql(m, "down.sql").length, `${m}: tiene down.sql`).toBeGreaterThan(0);
    }
    for (const m of [M7_1, M7_2, M7_4]) {
      expect(sql(m, "down.sql"), `${m}: la reversa ABORTA`).toMatch(/ABORTA/);
      for (const archivo of ["migration.sql", "down.sql"] as const) {
        expect(sql(m, archivo), `${m}/${archivo} no nombra políticas de alcance de sucursal`).not.toContain("alcance_sucursal_");
        expect(sql(m, archivo), `${m}/${archivo} no nombra el ayudante de alcance`).not.toContain("app_sucursales_");
      }
    }
    expect(sql(M7_2, "down.sql")).toContain('DROP TABLE IF EXISTS "DistribucionCostoLinea"');
    expect(sql(M7_1, "down.sql")).toContain('DROP TABLE IF EXISTS "PlanDeCostos"');
    expect(MIGRACIONES_DE_POLITICAS_POSTERIORES.map((g) => g.migracion)).toContain(M7_3);
    expect(MIGRACIONES_DE_POLITICAS_POSTERIORES.find((g) => g.migracion === M7_3)!.tablas).toEqual(["DistribucionCostoLinea", "DistribucionCostoVersion", "PlanDeCostosSucursal"]);
    for (const m of [M7_1, M7_2, M7_4]) expect(MIGRACIONES_DE_POLITICAS_POSTERIORES.map((g) => g.migracion), m).not.toContain(m);
    for (const m of M7) expect(MIGRACIONES_DE_POLITICAS_DE_SUCURSAL.map((g) => g.migracion), m).not.toContain(m);
    for (const t of TABLAS_M7) expect(TABLAS_DEL_PAQUETE_1, t).not.toContain(t);
    expect(TABLAS_DEL_PAQUETE_1).toHaveLength(32);
  });

  it("8.1. SUBIR: M7.1 a M7.4 sobre M6 arriba dejan las cinco tablas, los CHECK, las claves foráneas (las de tres columnas con su definición), los únicos, las políticas, los privilegios exactos (de tabla y por columna), las tres claves del admin y un humo como motor2_app", async (ctx) => {
    if (!hayRol) return ctx.skip();
    antesDeM7 = await foto();
    for (const t of TABLAS_M7) expect(antesDeM7.rls.find((r) => r.tabla === t), `antes de M7 ${t} no existe`).toBeUndefined();
    for (const m of M7) await correr(m, "migration.sql");
    await comprobarArribaM7("primera subida de M7");
    arribaConM7 = await foto();
    expect(arribaConM7.columnas.length, "sanidad de la foto").toBeGreaterThan(antesDeM7.columnas.length + 35);
  });

  it("8.2. BAJAR CON DATOS: el down de M7.4 ABORTA con la configuración tocada (y se restaura); con M7 arriba el de M4.3 FALLA con 2BP01 sin dejar nada a medias; el de M7.3 pasa; el de M7.2 y el de M7.1 ABORTAN con filas; sin filas el catálogo queda IDÉNTICO al de antes de M7", async (ctx) => {
    if (!hayRol) return ctx.skip();
    const c = base.cliente;
    await sembrarGastosParaM7();
    await sembrarCentrosParaM7();

    // 1) M7.4 ABORTA si la configuración cambió, sin tocar nada; con la semilla pura pasa.
    await c.query(`UPDATE "PermisoRol" SET "puedeEditar" = false WHERE "rolId" = 'rol_admin_m4' AND "accionClave" = 'distribucion_costos'`);
    await expect(correr(M7_4, "down.sql")).rejects.toThrow(/No se puede bajar M7\.4: hay 1 fila/);
    expect(Number((await q<{ n: string }>(`SELECT count(*) AS n FROM "Accion" WHERE "clave" = ANY($1)`, [CLAVES_M7]))[0]!.n), "el aborto no borró las claves").toBe(3);
    await c.query(`UPDATE "PermisoRol" SET "puedeEditar" = true WHERE "rolId" = 'rol_admin_m4' AND "accionClave" = 'distribucion_costos'`);
    await correr(M7_4, "down.sql");
    expect(await q(`SELECT 1 FROM "Accion" WHERE "clave" = ANY($1)`, [CLAVES_M7]), "sin las tres claves").toEqual([]);
    expect(await q(`SELECT 1 FROM "PermisoRol" WHERE "accionClave" = ANY($1)`, [CLAVES_M7]), "sin lo configurado sobre ellas").toEqual([]);

    // 2) Con M7 arriba, el down de M4.3 (DROP TABLE de la imputación) FALLA por dependencia (clave foránea y políticas de la versión), sin dejar nada a medias.
    const conM7 = await foto();
    await expect(correr(M4_3, "down.sql")).rejects.toMatchObject({ code: "2BP01" });
    const intacta = await foto();
    for (const k of Object.keys(conM7) as (keyof typeof conM7)[]) expect(intacta[k], `el down de M4.3 bloqueado no deja nada a medias («${k}»)`).toEqual(conM7[k]);
    expect(Number((await q<{ n: string }>(`SELECT count(*) AS n FROM "ImputacionDeGasto"`))[0]!.n), "las imputaciones siguen").toBe(2);

    // 3) M7.3 pasa (no es destructiva): las 12 políticas de sucursal se van y las tablas conservan sus datos.
    await correr(M7_3, "down.sql");
    expect(await q(`SELECT 1 FROM pg_policies WHERE tablename = ANY($1) AND policyname LIKE 'alcance\\_sucursal\\_%'`, [TABLAS_M7]), "sin las políticas de sucursal de M7").toEqual([]);
    expect(Number((await q<{ n: string }>(`SELECT count(*) AS n FROM "DistribucionCostoVersion"`))[0]!.n), "la versión sigue").toBe(1);

    // 4) M7.2 y M7.1 ABORTAN con filas, sin dejar nada a medias.
    const antesDelAborto = await foto();
    await expect(correr(M7_2, "down.sql")).rejects.toThrow(/No se puede bajar M7\.2: hay 1 versión\(es\) y 1 línea\(s\)/);
    await expect(correr(M7_1, "down.sql")).rejects.toThrow(/No se puede bajar M7\.1: hay 2 plan\(es\), 2 centro\(s\) y 1 fila\(s\) de aplicabilidad/);
    const sinTocar = await foto();
    for (const k of Object.keys(antesDelAborto) as (keyof typeof antesDelAborto)[]) expect(sinTocar[k], `el aborto no deja nada a medias («${k}»)`).toEqual(antesDelAborto[k]);

    // 5) Sin filas: M7.2 pasa; M7.1 sigue abortando mientras haya catálogo; vaciado el catálogo, pasa.
    await c.query(`DELETE FROM "DistribucionCostoLinea"`);
    await c.query(`DELETE FROM "DistribucionCostoVersion"`);
    await correr(M7_2, "down.sql");
    for (const t of ["DistribucionCostoVersion", "DistribucionCostoLinea"]) expect(await q(`SELECT 1 FROM pg_class WHERE relname = '${t}' AND relnamespace = 'public'::regnamespace`), `sin la tabla ${t}`).toEqual([]);
    await expect(correr(M7_1, "down.sql")).rejects.toThrow(/No se puede bajar M7\.1/);
    await c.query(`DELETE FROM "PlanDeCostosSucursal"`);
    await c.query(`DELETE FROM "CentroDeCostos"`);
    await c.query(`DELETE FROM "PlanDeCostos"`);
    await correr(M7_1, "down.sql");

    const despues = await foto();
    for (const k of Object.keys(antesDeM7) as (keyof typeof antesDeM7)[]) expect(despues[k], `catálogo «${k}» igual que antes de M7`).toEqual(antesDeM7[k]);
    for (const t of TABLAS_M7) expect(await q(`SELECT 1 FROM pg_class WHERE relname = '${t}' AND relnamespace = 'public'::regnamespace`), `sin la tabla ${t}`).toEqual([]);
    expect(Number((await q<{ n: string }>(`SELECT count(*) AS n FROM "ImputacionDeGasto"`))[0]!.n), "lo de M4 sigue: las imputaciones").toBe(2);
  });

  it("8.3. SUBIR OTRA VEZ: las mismas comprobaciones, las tablas vuelven vacías y el catálogo es idéntico al de la primera subida", async (ctx) => {
    if (!hayRol) return ctx.skip();
    for (const m of M7) await correr(m, "migration.sql");
    for (const t of TABLAS_M7) expect(Number((await q<{ n: string }>(`SELECT count(*) AS n FROM "${t}"`))[0]!.n), `${t} volvió vacía`).toBe(0);
    await comprobarArribaM7("segunda subida de M7");
    const otraVez = await foto();
    for (const k of Object.keys(arribaConM7) as (keyof typeof arribaConM7)[]) expect(otraVez[k], `catálogo «${k}» igual que la primera vez`).toEqual(arribaConM7[k]);
  });

  it("8.4. EL CICLO COMPLETO: se baja M7.4 a M7.1, M6.4 a M6.1, M5, M4.5 a M4.1 y M3e a M3a hasta el Paquete 2 (catálogo idéntico al de entonces) y se sube todo otra vez (M3, M4, M5, M6 y M7) hasta el mismo catálogo con M7 arriba", async (ctx) => {
    if (!hayRol) return ctx.skip();
    // Sin datos que las reversas protegen: las tablas de M7 y las notas de M6 (sus down abortan con filas), la de M5 y los gastos (el down de M4.2 aborta si los hay).
    await vaciarTablasDeM7();
    await vaciarLasNotas();
    await base.cliente.query(`DELETE FROM "ReclasificacionRenglon"`);
    await base.cliente.query(`DELETE FROM "ImputacionDeGasto"`);
    await base.cliente.query(`DELETE FROM "FacturaProveedorRenglon" WHERE "naturaleza" = 'SIN_STOCK'`);
    for (const m of [...BAJADA_M7, ...BAJADA_M6, M5, ...BAJADA]) await correr(m, "down.sql");
    for (const m of [...M3].reverse()) await correr(m, "down.sql");
    const abajo = await foto();
    for (const k of Object.keys(antesDeM3) as (keyof typeof antesDeM3)[]) expect(abajo[k], `catálogo «${k}» igual que antes de M3`).toEqual(antesDeM3[k]);
    for (const m of [...M3, ...SUBIDA, M5, ...SUBIDA_M6, ...M7]) await correr(m, "migration.sql");
    await comprobarArribaM7("ciclo completo de M7");
    const otraVez = await foto();
    for (const k of Object.keys(arribaConM7) as (keyof typeof arribaConM7)[]) expect(otraVez[k], `catálogo «${k}» igual que la primera vez`).toEqual(arribaConM7[k]);
  });

  it("8.5. Las reversas de M7 son idempotentes (IF EXISTS): bajar cada una dos veces no falla, deja el catálogo de antes de M7, y volver a subir deja todo arriba", async (ctx) => {
    if (!hayRol) return ctx.skip();
    for (const m of BAJADA_M7) {
      await correr(m, "down.sql");
      await correr(m, "down.sql");
    }
    const abajo = await foto();
    for (const k of Object.keys(antesDeM7) as (keyof typeof antesDeM7)[]) expect(abajo[k], `catálogo «${k}» igual que antes de M7`).toEqual(antesDeM7[k]);
    for (const m of M7) await correr(m, "migration.sql");
    await comprobarArribaM7("tercera subida de M7");
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// GO-1 (GRUPOS DE OPCIONES DE VENTA: GO-1a a GO-1d-rls): sigue en el MISMO archivo para reutilizar la base temporal, la foto del catálogo y los ayudantes, y parte del estado que dejó el último caso de M7 (M3 a M7 arriba). Es independiente de ellas.
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
const GO1_A = "20261020100000_go1a_permisos_de_opciones";
const GO1_B = "20261020110000_go1b_grupos_y_opciones";
const GO1_C = "20261020120000_go1c_opciones_por_sucursal";
const GO1_C_RLS = "20261020121000_go1c_rls_sucursal_opciones_por_sucursal";
const GO1_D = "20261020130000_go1d_linea_con_opciones";
const GO1_D_RLS = "20261020131000_go1d_rls_sucursal_opcion_elegida";
const GO1 = [GO1_A, GO1_B, GO1_C, GO1_C_RLS, GO1_D, GO1_D_RLS];
/** La reversa va en orden inverso: las políticas de la foto, la línea con opciones, las políticas por sucursal, lo de la sucursal, el catálogo y las claves. */
const BAJADA_GO1 = [GO1_D_RLS, GO1_D, GO1_C_RLS, GO1_C, GO1_B, GO1_A];
/** Las tres claves de GO-1a, FIJAS: desde GO-2a están en ACCIONES y ya no en las reservadas (sacadas de ahí, la lista quedaría vacía y estas comprobaciones pasarían sin mirar nada). */
const CLAVES_GO1 = ["opcion_apagar_en_sucursal", "opciones_definir", "producto_opciones_admitidas"];
const CATALOGO_GO1 = ["GrupoDeOpciones", "OpcionDeGrupo", "VersionDeOpcion", "ConsumoDeOpcion", "ProductoAdmiteGrupo", "ProductoAdmiteOpcion"];
const POR_SUCURSAL_GO1 = ["PrecioLocalDeOpcion", "OpcionApagadaEnSucursal", "OpcionElegidaEnLinea"];
const TABLAS_GO1 = [...CATALOGO_GO1, ...POR_SUCURSAL_GO1];
const CHECKS_GO1 = [
  "ConsumoDeOpcion_cantidad_chk", "ConsumoDeOpcion_efecto_chk", "ConsumoDeOpcion_merma_chk", "ConsumoDeOpcion_orden_chk", "ConsumoDeOpcion_reemplazo_chk", "GrupoDeOpciones_cantidades_chk", "GrupoDeOpciones_incluida_chk", "GrupoDeOpciones_medida_chk",
  "GrupoDeOpciones_nombre_chk", "GrupoDeOpciones_tipo_chk", "GrupoDeOpciones_version_chk", "OpcionDeGrupo_ninguna_sin_producto_chk", "OpcionDeGrupo_nombre_chk", "OpcionDeGrupo_orden_chk", "OpcionDeGrupo_version_chk", "OpcionElegidaEnLinea_absoluto_chk",
  "OpcionElegidaEnLinea_adicional_chk", "OpcionElegidaEnLinea_cantidad_chk", "OpcionElegidaEnLinea_diferencia_chk", "OpcionElegidaEnLinea_diferencia_de_medida_chk", "OpcionElegidaEnLinea_factor_chk", "OpcionElegidaEnLinea_incluida_chk",
  "OpcionElegidaEnLinea_medida_chk", "OpcionElegidaEnLinea_modo_precio_chk", "OpcionElegidaEnLinea_nombres_chk", "OpcionElegidaEnLinea_porcentaje_chk", "OpcionElegidaEnLinea_porcentaje_solo_medida_variante_chk",
  "OpcionElegidaEnLinea_tipo_de_diferencia_chk", "OpcionElegidaEnLinea_tipo_grupo_chk", "PrecioLocalDeOpcion_precio_chk", "ProductoAdmiteGrupo_cantidades_chk", "ProductoAdmiteGrupo_modo_precio_chk", "ProductoAdmiteGrupo_orden_chk",
  "ProductoAdmiteGrupo_version_chk", "ProductoAdmiteOpcion_absoluto_o_diferencia_chk", "ProductoAdmiteOpcion_cantidad_maxima_chk", "ProductoAdmiteOpcion_diferencia_chk", "ProductoAdmiteOpcion_porcentaje_chk",
  "ProductoAdmiteOpcion_precio_absoluto_chk", "ProductoAdmiteOpcion_tipo_de_diferencia_chk", "ProductoAdmiteOpcion_version_chk", "VersionDeOpcion_diferencia_chk", "VersionDeOpcion_factor_chk", "VersionDeOpcion_numero_chk",
  "VersionDeOpcion_porcentaje_chk", "VersionDeOpcion_tipo_de_diferencia_chk",
];
const CLAVES_FORANEAS_GO1 = [
  "ConsumoDeOpcion_empresaId_fkey", "ConsumoDeOpcion_empresaId_insumoProductoId_fkey", "ConsumoDeOpcion_empresaId_reemplazaAProductoId_fkey", "ConsumoDeOpcion_empresaId_unidadId_fkey", "ConsumoDeOpcion_empresaId_versionDeOpcionId_fkey",
  "GrupoDeOpciones_empresaId_fkey", "OpcionApagadaEnSucursal_actualizadoPorId_fkey", "OpcionApagadaEnSucursal_empresaId_fkey", "OpcionApagadaEnSucursal_empresaId_opcionId_fkey", "OpcionApagadaEnSucursal_empresaId_sucursalId_fkey",
  "OpcionDeGrupo_empresaId_fkey", "OpcionDeGrupo_empresaId_grupoId_fkey", "OpcionDeGrupo_empresaId_productoId_fkey", "OpcionElegidaEnLinea_empresaId_cuentaItemId_fkey", "OpcionElegidaEnLinea_empresaId_fkey",
  "OpcionElegidaEnLinea_empresaId_grupoId_fkey", "OpcionElegidaEnLinea_empresaId_opcionId_fkey", "OpcionElegidaEnLinea_empresaId_versionDeOpcionId_fkey", "PrecioLocalDeOpcion_empresaId_fkey", "PrecioLocalDeOpcion_empresaId_opcionId_fkey",
  "PrecioLocalDeOpcion_empresaId_productoId_fkey", "PrecioLocalDeOpcion_empresaId_sucursalId_fkey", "ProductoAdmiteGrupo_empresaId_fkey", "ProductoAdmiteGrupo_empresaId_grupoId_fkey", "ProductoAdmiteGrupo_empresaId_productoId_fkey",
  "ProductoAdmiteOpcion_empresaId_fkey", "ProductoAdmiteOpcion_empresaId_opcionId_fkey", "ProductoAdmiteOpcion_empresaId_productoId_fkey", "VersionDeOpcion_creadoPorId_fkey", "VersionDeOpcion_empresaId_fkey", "VersionDeOpcion_empresaId_opcionId_fkey",
];
const UNICOS_GO1 = [
  "ConsumoDeOpcion_empresaId_id_key", "ConsumoDeOpcion_un_reemplazo_por_insumo_key", "ConsumoDeOpcion_versionDeOpcionId_orden_key", "GrupoDeOpciones_empresaId_id_key", "GrupoDeOpciones_empresaId_nombre_key", "GrupoDeOpciones_nombre_lower_key",
  "OpcionApagadaEnSucursal_empresaId_id_key", "OpcionApagadaEnSucursal_sucursalId_opcionId_key", "OpcionDeGrupo_empresaId_id_key", "OpcionDeGrupo_empresaId_productoId_key", "OpcionDeGrupo_grupoId_nombre_key", "OpcionDeGrupo_nombre_lower_key",
  "OpcionDeGrupo_una_ninguna_por_grupo_key", "OpcionElegidaEnLinea_cuentaItemId_opcionId_key", "OpcionElegidaEnLinea_empresaId_id_key", "OpcionElegidaEnLinea_un_adicional_por_linea_key", "OpcionElegidaEnLinea_una_medida_por_linea_key",
  "PrecioLocalDeOpcion_empresaId_id_key", "PrecioLocalDeOpcion_sucursalId_productoId_opcionId_key", "ProductoAdmiteGrupo_empresaId_id_key", "ProductoAdmiteGrupo_productoId_grupoId_key", "ProductoAdmiteOpcion_empresaId_id_key",
  "ProductoAdmiteOpcion_productoId_opcionId_key", "VersionDeOpcion_empresaId_id_key", "VersionDeOpcion_opcionId_numero_key",
];
/** Las columnas de UPDATE de `motor2_app` en las tablas editables de GO-1; en las otras (versiones, consumos, foto) no hay ninguna. */
const ACTUALIZABLES_GO1: Readonly<Record<string, readonly string[]>> = {
  GrupoDeOpciones: ["activo", "actualizadoEn", "cantidadMaxima", "cantidadMinima", "nombre", "version"],
  OpcionDeGrupo: ["activa", "actualizadoEn", "nombre", "orden", "version"],
  ProductoAdmiteGrupo: ["activo", "actualizadoEn", "cantidadMaxima", "cantidadMinima", "modoPrecio", "orden", "version"],
  ProductoAdmiteOpcion: ["activo", "actualizadoEn", "cantidadMaxima", "diferenciaPrecio", "porcentaje", "precioAbsoluto", "tipoDeDiferencia", "version"],
  PrecioLocalDeOpcion: ["actualizadoEn", "habilitado", "precio"],
  OpcionApagadaEnSucursal: ["actualizadoEn", "actualizadoPorId", "apagada"],
  VersionDeOpcion: [],
  ConsumoDeOpcion: [],
  OpcionElegidaEnLinea: [],
};

/** Vacía, como dueño y en el orden de sus claves foráneas, todo lo que GO-1 escribe (y lo que el humo sembró para él). Solo si GO-1 ya está arriba. */
async function vaciarTablasDeGO1() {
  const c = base.cliente;
  // Se usa también con GO-1 a medio bajar: solo se vacía lo que existe.
  const hayTabla = async (t: string) => (await q<{ r: string | null }>(`SELECT to_regclass('"${t}"')::text AS r`))[0]!.r !== null;
  const hayColumna = async (t: string, columna: string) => (await q(`SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${t}' AND column_name = '${columna}'`)).length > 0;
  for (const t of ["OpcionElegidaEnLinea", "PrecioLocalDeOpcion", "OpcionApagadaEnSucursal", "ConsumoDeOpcion", "VersionDeOpcion", "ProductoAdmiteOpcion", "ProductoAdmiteGrupo", "OpcionDeGrupo", "GrupoDeOpciones"]) if (await hayTabla(t)) await c.query(`DELETE FROM "${t}"`);
  if (await hayColumna("Operacion", "operacionPadreId")) await c.query(`DELETE FROM "Operacion" WHERE "operacionPadreId" IS NOT NULL`);
  await c.query(`DELETE FROM "CuentaItem" WHERE "anulaAItemId" IS NOT NULL`);
  if (await hayColumna("CuentaItem", "lineaPadreId")) await c.query(`DELETE FROM "CuentaItem" WHERE "lineaPadreId" IS NOT NULL`);
  await c.query(`DELETE FROM "CuentaItem"`);
  await c.query(`DELETE FROM "Operacion" WHERE "id" LIKE 'op_go1%'`);
  await c.query(`DELETE FROM "Cuenta"`);
  await c.query(`DELETE FROM "Mesa"`);
  await c.query(`DELETE FROM "Producto" WHERE "id" LIKE 'pro_go1%'`);
}

/** La base mínima del humo de GO-1, como dueño: dos productos de venta (el café y el ancla del shot), una mesa con su cuenta por sucursal. */
async function sembrarBaseParaGO1() {
  const c = base.cliente;
  await vaciarTablasDeGO1();
  await c.query(`INSERT INTO "Producto" ("id","empresaId","codigo","nombre","tipo","unidadStockId") VALUES ('pro_go1_cafe',$1,'PV_CAFE','Café','PV','uni_m4'), ('pro_go1_shot',$1,'PV_SHOT','Shot extra (ancla)','PV','uni_m4')`, [E]);
  await c.query(`INSERT INTO "Mesa" ("id","empresaId","sucursalId","numero") VALUES ('mesa_a',$1,'suc_a',1), ('mesa_b',$1,'suc_b',1)`, [E]);
  await c.query(`INSERT INTO "Cuenta" ("id","empresaId","mesaId","abiertaPorId") VALUES ('cta_a',$1,'mesa_a','u_m4'), ('cta_b',$1,'mesa_b','u_m4')`, [E]);
}

/** El catálogo mínimo de café, la grilla y el apagado de la sucursal B y una línea con su foto en la cuenta de B, sembrados como dueño: lo que el humo de la sucursal A no tiene que ver y lo que una reversa con datos tiene que respetar. */
async function sembrarOpcionesParaGO1() {
  const c = base.cliente;
  await sembrarBaseParaGO1();
  await c.query(`INSERT INTO "GrupoDeOpciones" ("empresaId","id","nombre","tipo","cantidadMinima","cantidadMaxima") VALUES ('${E}','gr_leche','Leche','VARIANTE',0,1), ('${E}','gr_extras','Extras','ADICIONAL',0,3)`);
  await c.query(`INSERT INTO "OpcionDeGrupo" ("empresaId","id","grupoId","nombre","productoId") VALUES ('${E}','op_vaca','gr_leche','De vaca',NULL), ('${E}','op_shot','gr_extras','Shot extra','pro_go1_shot')`);
  await c.query(`INSERT INTO "VersionDeOpcion" ("empresaId","id","opcionId","numero","tipoDeDiferencia","diferenciaPrecio","creadoPorId") VALUES ('${E}','ver_vaca','op_vaca',1,'MONTO',0,'u_m4'), ('${E}','ver_shot','op_shot',1,'MONTO',200.00,'u_m4')`);
  await c.query(`INSERT INTO "ConsumoDeOpcion" ("empresaId","id","versionDeOpcionId","efecto","insumoProductoId","cantidad","unidadId") VALUES ('${E}','con_shot','ver_shot','SUMA','pro_m4',1,'uni_m4')`);
  await c.query(`INSERT INTO "ProductoAdmiteGrupo" ("empresaId","id","productoId","grupoId") VALUES ('${E}','pag_1','pro_go1_cafe','gr_leche')`);
  await c.query(`INSERT INTO "ProductoAdmiteOpcion" ("empresaId","id","productoId","opcionId") VALUES ('${E}','pao_1','pro_go1_cafe','op_vaca')`);
  await c.query(`INSERT INTO "PrecioLocalDeOpcion" ("empresaId","id","sucursalId","productoId","opcionId","precio") VALUES ('${E}','pl_b','suc_b','pro_go1_cafe','op_vaca',250.00)`);
  await c.query(`INSERT INTO "OpcionApagadaEnSucursal" ("empresaId","id","sucursalId","opcionId","apagada","actualizadoPorId") VALUES ('${E}','ap_b','suc_b','op_shot',true,'u_m4')`);
  await c.query(`INSERT INTO "CuentaItem" ("empresaId","id","cuentaId","productoId","cantidad","precioUnitario","huellaOpciones") VALUES ('${E}','it_b','cta_b','pro_go1_cafe',1,1000.00,'${"ab".repeat(32)}')`);
  await c.query(`INSERT INTO "OpcionElegidaEnLinea" ("empresaId","id","cuentaItemId","grupoId","opcionId","versionDeOpcionId","tipoGrupo","nombreGrupo","nombreOpcion","importeUnitario") VALUES ('${E}','fo_b','it_b','gr_leche','op_vaca','ver_vaca','VARIANTE','Leche','De vaca',0)`);
}

/** Las comprobaciones de «GO-1 aplicada» (el humo corre en transacciones que se deshacen: no deja ninguna fila de GO-1 salvo lo que sembró el dueño, que se borra al final). */
async function comprobarArribaGO1(etiqueta: string) {
  const f = await foto();
  const deLaTabla = (t: string) => f.restricciones.filter((r) => r.tabla === `"${t}"`);
  for (const t of TABLAS_GO1) expect(f.rls.find((r) => r.tabla === t), `${etiqueta}: ${t} con RLS y sin FORCE`).toEqual({ tabla: t, rls: true, forzado: false });
  const checks = TABLAS_GO1.flatMap((t) => deLaTabla(t).filter((r) => r.contype === "c"));
  expect(checks.map((r) => r.nombre).sort(), `${etiqueta}: los CHECK de las nueve tablas`).toEqual([...CHECKS_GO1].sort());
  expect(checks.every((r) => r.convalidated), `${etiqueta}: los CHECK validados`).toBe(true);
  expect(TABLAS_GO1.flatMap((t) => deLaTabla(t).filter((r) => r.contype === "f")).map((r) => r.nombre).sort(), `${etiqueta}: las claves foráneas (todas de una o dos columnas)`).toEqual([...CLAVES_FORANEAS_GO1].sort());
  const def = (nombre: string) => String(f.restricciones.find((r) => r.nombre === nombre)!.definicion);
  expect(def("OpcionElegidaEnLinea_empresaId_cuentaItemId_fkey"), `${etiqueta}: la foto se borra con su línea`).toBe('FOREIGN KEY ("empresaId", "cuentaItemId") REFERENCES "CuentaItem"("empresaId", id) ON UPDATE CASCADE ON DELETE CASCADE');
  expect(def("CuentaItem_empresaId_lineaPadreId_fkey"), `${etiqueta}: un padre con adicionales no se borra`).toBe('FOREIGN KEY ("empresaId", "lineaPadreId") REFERENCES "CuentaItem"("empresaId", id) ON UPDATE CASCADE ON DELETE RESTRICT');
  expect(def("Operacion_empresaId_operacionPadreId_fkey"), `${etiqueta}: la operación padre no se borra`).toBe('FOREIGN KEY ("empresaId", "operacionPadreId") REFERENCES "Operacion"("empresaId", id) ON UPDATE CASCADE ON DELETE RESTRICT');
  for (const n of ["CuentaItem_adicional_chk", "CuentaItem_huella_opciones_chk", "Operacion_padre_solo_venta_chk"]) expect(f.restricciones.find((r) => r.nombre === n)?.convalidated, `${etiqueta}: ${n} puesto y validado`).toBe(true);
  const unicos = f.indices.filter((i) => TABLAS_GO1.includes(String(i.tabla)) && String(i.indexdef).startsWith("CREATE UNIQUE INDEX") && !String(i.nombre).endsWith("_pkey"));
  expect(unicos.map((i) => i.nombre).sort(), `${etiqueta}: los índices únicos y parciales`).toEqual([...UNICOS_GO1].sort());
  expect(String(f.indices.find((i) => i.nombre === "OpcionDeGrupo_una_ninguna_por_grupo_key")!.indexdef), `${etiqueta}: una «ninguna» por grupo`).toMatch(/WHERE "esNinguna"/);
  expect(String(f.indices.find((i) => i.nombre === "ConsumoDeOpcion_un_reemplazo_por_insumo_key")!.indexdef), `${etiqueta}: un reemplazo por insumo`).toMatch(/WHERE \("reemplazaAProductoId" IS NOT NULL\)/);
  expect(String(f.indices.find((i) => i.nombre === "GrupoDeOpciones_nombre_lower_key")!.indexdef), `${etiqueta}: el nombre del grupo es único sin importar mayúsculas`).toMatch(/lower\(nombre\)/);
  expect(f.indices.filter((i) => ["CuentaItem_lineaPadreId_idx", "Operacion_operacionPadreId_idx"].includes(String(i.nombre))).map((i) => i.nombre).sort(), `${etiqueta}: los índices de los padres`).toEqual(["CuentaItem_lineaPadreId_idx", "Operacion_operacionPadreId_idx"]);
  expect(f.columnas.filter((c) => ["huellaOpciones", "lineaPadreId", "operacionPadreId"].includes(String(c.columna))).map((c) => `${c.tabla}.${c.columna}:${c.is_nullable}`).sort(), `${etiqueta}: las tres columnas nuevas, nulables`).toEqual([
    "CuentaItem.huellaOpciones:YES", "CuentaItem.lineaPadreId:YES", "Operacion.operacionPadreId:YES",
  ]);

  // Políticas: el catálogo solo con la de empresa; las tres de sucursal con la de empresa y las cuatro de sucursal; el total de alcance pasa de 156 a 168.
  for (const t of CATALOGO_GO1) expect(f.politicas.filter((p) => p.tabla === t).map((p) => p.nombre), `${etiqueta}: ${t} solo con la política de empresa`).toEqual(["aislamiento_empresa"]);
  for (const t of POR_SUCURSAL_GO1) {
    const de = f.politicas.filter((p) => p.tabla === t);
    expect(de.map((p) => p.nombre), `${etiqueta}: ${t}`).toEqual(["alcance_sucursal_delete", "alcance_sucursal_insert", "alcance_sucursal_select", "alcance_sucursal_update", "aislamiento_empresa"].sort());
    for (const p of de.filter((x) => String(x.nombre).startsWith("alcance_sucursal_"))) expect([p.permissive, p.roles], `${etiqueta}: ${t}.${p.nombre}`).toEqual(["RESTRICTIVE", "{motor2_app}"]);
  }
  expect(f.politicas.filter((p) => String(p.nombre).startsWith("alcance_sucursal_")), `${etiqueta}: 128 del Paquete 1 + 28 de Venta, la parte, la imputación, la nota (M6) y M7 + 12 de GO-1`).toHaveLength(TABLAS_DEL_PAQUETE_1.length * COMANDOS_CON_POLITICA_DE_ALCANCE.length + 40);

  // Los tres disparadores, con su definición exacta, y sus funciones.
  const disparadores = f.disparadores.filter((d) => ["CuentaItem_opciones_chk", "OpcionElegidaEnLinea_coherente_chk", "Operacion_padre_inmutable_chk"].includes(String(d.nombre)));
  expect(disparadores.map((d) => [d.tabla, d.nombre, d.habilitado, d.definicion]), `${etiqueta}: los tres disparadores`).toEqual([
    ['"CuentaItem"', "CuentaItem_opciones_chk", "O", 'CREATE TRIGGER "CuentaItem_opciones_chk" BEFORE INSERT OR UPDATE OF "huellaOpciones", "lineaPadreId", "cuentaId" ON public."CuentaItem" FOR EACH ROW EXECUTE FUNCTION "CuentaItem_reglas_de_opciones"()'],
    ['"OpcionElegidaEnLinea"', "OpcionElegidaEnLinea_coherente_chk", "O", 'CREATE TRIGGER "OpcionElegidaEnLinea_coherente_chk" BEFORE INSERT ON public."OpcionElegidaEnLinea" FOR EACH ROW EXECUTE FUNCTION "OpcionElegidaEnLinea_coherente_con_su_linea"()'],
    ['"Operacion"', "Operacion_padre_inmutable_chk", "O", 'CREATE TRIGGER "Operacion_padre_inmutable_chk" BEFORE UPDATE OF "operacionPadreId" ON public."Operacion" FOR EACH ROW EXECUTE FUNCTION "Operacion_padre_inmutable"()'],
  ]);
  expect(f.funciones.map((x) => x.nombre).filter((n) => ["CuentaItem_reglas_de_opciones", "OpcionElegidaEnLinea_coherente_con_su_linea", "Operacion_padre_inmutable"].includes(String(n))).sort(), `${etiqueta}: sus tres funciones`).toEqual([
    "CuentaItem_reglas_de_opciones", "OpcionElegidaEnLinea_coherente_con_su_linea", "Operacion_padre_inmutable",
  ]);

  // Privilegios exactos: las nueve solo se agregan, salvo UPDATE por columna de las editables; nada para motor2_plataforma ni DELETE.
  for (const t of TABLAS_GO1) expect(f.privilegios.filter((p) => p.tabla === t), `${etiqueta}: ${t}: solo se agrega`).toEqual([{ tabla: t, rol: "motor2_app", privilege_type: "INSERT" }, { tabla: t, rol: "motor2_app", privilege_type: "SELECT" }]);
  const conUpdate = (t: string) => f.privilegiosDeColumna.filter((p) => p.tabla === t && p.privilege_type === "UPDATE" && p.rol === "motor2_app").map((p) => p.columna).sort();
  for (const [t, columnas] of Object.entries(ACTUALIZABLES_GO1)) expect(conUpdate(t), `${etiqueta}: UPDATE de ${t}`).toEqual([...columnas]);

  // GO-1a: las tres claves, solo del admin.
  expect((await q<{ clave: string }>(`SELECT "clave" FROM "Accion" WHERE "clave" = ANY($1) ORDER BY 1`, [CLAVES_GO1])).map((a) => a.clave), `${etiqueta}: las tres claves existen`).toEqual(CLAVES_GO1);
  expect(await q(`SELECT DISTINCT "rolId" FROM "PermisoRol" WHERE "accionClave" = ANY($1) ORDER BY 1`, [CLAVES_GO1]), `${etiqueta}: solo el admin tiene alguna`).toEqual([{ rolId: "rol_admin_m4" }]);
  expect(Number((await q<{ n: string }>(`SELECT count(*) AS n FROM "PermisoRol" WHERE "accionClave" = ANY($1)`, [CLAVES_GO1]))[0]!.n), `${etiqueta}: tres filas del admin`).toBe(3);

  // Humo como el rol real de la app (todo dentro de una transacción que se deshace).
  await sembrarOpcionesParaGO1();
  app ??= await conectarComoApp();
  const humo = async (alcance: { lectura?: string; escritura?: string }, fn: (c: Client) => Promise<void>) => {
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
  const linea = (id: string, cuenta: string, producto: string, extra = "", precio = "1000.00") => `INSERT INTO "CuentaItem" ("id","cuentaId","productoId","cantidad","precioUnitario"${extra ? ',' + extra.split('=')[0] : ""}) VALUES ('${id}','${cuenta}','${producto}',1,${precio}${extra ? ',' + extra.split('=')[1] : ""})`;
  const foto1 = (id: string, linea: string, grupo: string, opcion: string, version: string, tipo: string, extra = "") =>
    `INSERT INTO "OpcionElegidaEnLinea" ("id","cuentaItemId","grupoId","opcionId","versionDeOpcionId","tipoGrupo","nombreGrupo","nombreOpcion","importeUnitario"${extra ? ',"tipoDeDiferencia"' : ""}) VALUES ('${id}','${linea}','${grupo}','${opcion}','${version}','${tipo}','Grupo','Opción',${tipo === "ADICIONAL" ? "200.00" : "0"}${extra ? `,'${extra}'` : ""})`;
  await humo({}, async (c) => {
    expect(await falla(c, `INSERT INTO "GrupoDeOpciones" ("id","nombre","tipo") VALUES ('gr_sin_alcance','Sin alcance','VARIANTE')`), `${etiqueta}: dar de alta un grupo no necesita alcance de sucursal (es de empresa)`).toBeNull();
    expect((await c.query(`SELECT id FROM "GrupoDeOpciones" ORDER BY id`)).rows.map((r) => r.id), `${etiqueta}: los grupos se ven aun sin alcance`).toEqual(["gr_extras", "gr_leche", "gr_sin_alcance"]);
    expect((await c.query(`SELECT id FROM "PrecioLocalDeOpcion"`)).rows, `${etiqueta}: sin alcance no se ve ningún precio local (falla cerrado)`).toEqual([]);
    expect((await c.query(`SELECT id FROM "OpcionApagadaEnSucursal"`)).rows, `${etiqueta}: ni ningún apagado`).toEqual([]);
    expect((await c.query(`SELECT id FROM "OpcionElegidaEnLinea"`)).rows, `${etiqueta}: ni ninguna foto`).toEqual([]);
    expect(await falla(c, `INSERT INTO "OpcionApagadaEnSucursal" ("id","sucursalId","opcionId","apagada","actualizadoPorId") VALUES ('ap_sin','suc_a','op_vaca',true,'u_m4')`), `${etiqueta}: sin alcance de escritura apagar da 42501`).toBe("42501");
  });
  await humo({ lectura: "suc_a", escritura: "suc_a" }, async (c) => {
    // El catálogo: grupo, opción, versión, consumo y lo que el producto admite.
    expect(await falla(c, `INSERT INTO "GrupoDeOpciones" ("id","nombre","tipo","cantidadMinima","cantidadMaxima") VALUES ('gr_med','Tamaño','MEDIDA',1,1)`), `${etiqueta}: un grupo MEDIDA 1 a 1 anda`).toBeNull();
    expect(await falla(c, `INSERT INTO "GrupoDeOpciones" ("id","nombre","tipo","cantidadMinima","cantidadMaxima") VALUES ('gr_med2','Tamaño 2','MEDIDA',0,1)`), `${etiqueta}: una MEDIDA con mínimo 0 da 23514`).toBe("23514");
    expect(await falla(c, `INSERT INTO "GrupoDeOpciones" ("id","nombre","tipo") VALUES ('gr_may','LECHE','VARIANTE')`), `${etiqueta}: el nombre repetido con otras mayúsculas da 23505`).toBe("23505");
    expect(await falla(c, `UPDATE "GrupoDeOpciones" SET "tipo" = 'ADICIONAL' WHERE id = 'gr_leche'`), `${etiqueta}: UPDATE del tipo da 42501`).toBe("42501");
    expect(await falla(c, `UPDATE "GrupoDeOpciones" SET "nombre" = 'Bebida', "version" = "version" + 1, "actualizadoEn" = now() WHERE id = 'gr_leche'`), `${etiqueta}: editar el nombre anda`).toBeNull();
    expect(await falla(c, `DELETE FROM "GrupoDeOpciones" WHERE id = 'gr_leche'`), `${etiqueta}: DELETE del grupo da 42501`).toBe("42501");
    expect(await falla(c, `INSERT INTO "OpcionDeGrupo" ("id","grupoId","nombre") VALUES ('op_grande','gr_med','Grande')`), `${etiqueta}: una opción anda`).toBeNull();
    expect(await falla(c, `INSERT INTO "VersionDeOpcion" ("id","opcionId","numero","tipoDeDiferencia","porcentaje","creadoPorId") VALUES ('ver_grande','op_grande',1,'PORCENTAJE',-100,'u_m4')`), `${etiqueta}: un porcentaje de -100 da 23514`).toBe("23514");
    expect(await falla(c, `INSERT INTO "VersionDeOpcion" ("id","opcionId","numero","tipoDeDiferencia","porcentaje","factorEscala","creadoPorId") VALUES ('ver_grande','op_grande',1,'PORCENTAJE',-99.9999,1.5,'u_m4')`), `${etiqueta}: la versión 1 anda`).toBeNull();
    expect(await falla(c, `INSERT INTO "VersionDeOpcion" ("id","opcionId","numero","tipoDeDiferencia","diferenciaPrecio","creadoPorId") VALUES ('ver_grande2','op_grande',1,'MONTO',1,'u_m4')`), `${etiqueta}: repetir (opción, número) da 23505`).toBe("23505");
    expect(await falla(c, `UPDATE "VersionDeOpcion" SET "diferenciaPrecio" = 1 WHERE id = 'ver_vaca'`), `${etiqueta}: UPDATE de una versión da 42501`).toBe("42501");
    expect(await falla(c, `UPDATE "ConsumoDeOpcion" SET "cantidad" = 5 WHERE id = 'con_shot'`), `${etiqueta}: UPDATE de un consumo da 42501`).toBe("42501");
    expect(await falla(c, `INSERT INTO "ProductoAdmiteOpcion" ("id","productoId","opcionId","tipoDeDiferencia","diferenciaPrecio") VALUES ('pao_x','pro_go1_shot','op_vaca',NULL,5)`), `${etiqueta}: un monto sin tipo da 23514 (el NULL no se cuela)`).toBe("23514");
    // Lo de la sucursal: el apagado y la grilla de A andan, los de B no; la grilla de B (sembrada) no se ve.
    expect(await falla(c, `INSERT INTO "OpcionApagadaEnSucursal" ("id","sucursalId","opcionId","apagada","actualizadoPorId") VALUES ('ap_a','suc_a','op_shot',true,'u_m4')`), `${etiqueta}: apagar en la propia sucursal anda`).toBeNull();
    expect(await falla(c, `INSERT INTO "OpcionApagadaEnSucursal" ("id","sucursalId","opcionId","apagada","actualizadoPorId") VALUES ('ap_otro','suc_a','op_shot',false,'u_m4') ON CONFLICT ("sucursalId","opcionId") DO UPDATE SET "apagada" = EXCLUDED."apagada"`), `${etiqueta}: prender de nuevo con ON CONFLICT DO UPDATE anda`).toBeNull();
    expect(await falla(c, `INSERT INTO "OpcionApagadaEnSucursal" ("id","sucursalId","opcionId","apagada","actualizadoPorId") VALUES ('ap_b2','suc_b','op_vaca',true,'u_m4')`), `${etiqueta}: apagar en otra sucursal da 42501`).toBe("42501");
    expect(await falla(c, `INSERT INTO "PrecioLocalDeOpcion" ("id","sucursalId","productoId","opcionId","precio") VALUES ('pl_a','suc_a','pro_go1_cafe','op_vaca',0)`), `${etiqueta}: un precio local de 0 da 23514`).toBe("23514");
    expect(await falla(c, `INSERT INTO "PrecioLocalDeOpcion" ("id","sucursalId","productoId","opcionId","precio") VALUES ('pl_a','suc_a','pro_go1_cafe','op_vaca',120.50)`), `${etiqueta}: la grilla de la propia sucursal anda`).toBeNull();
    expect((await c.query(`SELECT id FROM "PrecioLocalDeOpcion" ORDER BY id`)).rows.map((r) => r.id), `${etiqueta}: la sucursal A no ve la grilla de la B`).toEqual(["pl_a"]);
    expect((await c.query(`SELECT id FROM "OpcionApagadaEnSucursal" ORDER BY id`)).rows.map((r) => r.id), `${etiqueta}: ni lo apagado en la B`).toEqual(["ap_a"]);
    expect((await c.query(`SELECT id FROM "OpcionElegidaEnLinea"`)).rows, `${etiqueta}: ni la foto de la línea de la B`).toEqual([]);
    // La línea con opciones: padre con huella, su foto, un adicional con su foto; después la cascada.
    expect(await falla(c, linea("it_a", "cta_a", "pro_go1_cafe", `"huellaOpciones"='${"cd".repeat(32)}'`)), `${etiqueta}: la línea padre con huella anda`).toBeNull();
    expect(await falla(c, linea("it_mal", "cta_a", "pro_go1_cafe", `"huellaOpciones"='${"CD".repeat(32)}'`)), `${etiqueta}: una huella en mayúsculas da 23514`).toBe("23514");
    expect(await falla(c, foto1("fo_a", "it_a", "gr_leche", "op_vaca", "ver_vaca", "VARIANTE")), `${etiqueta}: la foto de la variante anda`).toBeNull();
    expect(await falla(c, foto1("fo_x", "it_a", "gr_leche", "op_vaca", "ver_shot", "VARIANTE")), `${etiqueta}: una versión de otra opción da 23514`).toBe("23514");
    expect(await falla(c, linea("ad_mal", "cta_a", "pro_go1_shot", `"lineaPadreId"='it_a'`, "0.00")), `${etiqueta}: un adicional en $0 da 23514`).toBe("23514");
    expect(await falla(c, linea("ad_a", "cta_a", "pro_go1_shot", `"lineaPadreId"='it_a'`, "200.00")), `${etiqueta}: el adicional con su padre anda`).toBeNull();
    expect(await falla(c, foto1("fo_ad", "ad_a", "gr_extras", "op_shot", "ver_shot", "ADICIONAL", "MONTO")), `${etiqueta}: la foto del adicional anda`).toBeNull();
    expect(await falla(c, linea("ad_ad", "cta_a", "pro_go1_shot", `"lineaPadreId"='ad_a'`, "200.00")), `${etiqueta}: un adicional de un adicional da 23514`).toBe("23514");
    expect(await falla(c, linea("ad_b", "cta_a", "pro_go1_shot", `"lineaPadreId"='it_b'`, "200.00")), `${etiqueta}: un adicional colgado de una línea de otra sucursal da 23514 (no se ve)`).toBe("23514");
    expect(await falla(c, `UPDATE "CuentaItem" SET "huellaOpciones" = '${"ef".repeat(32)}' WHERE id = 'it_a'`), `${etiqueta}: cambiar la huella da 23514`).toBe("23514");
    expect(await falla(c, `UPDATE "OpcionElegidaEnLinea" SET "importeUnitario" = 1 WHERE id = 'fo_a'`), `${etiqueta}: UPDATE de la foto da 42501`).toBe("42501");
    expect(await falla(c, `DELETE FROM "OpcionElegidaEnLinea" WHERE id = 'fo_a'`), `${etiqueta}: DELETE de la foto da 42501`).toBe("42501");
    expect(await falla(c, `DELETE FROM "CuentaItem" WHERE id = 'it_a'`), `${etiqueta}: borrar el padre con un adicional colgado da 23503`).toBe("23503");
    expect(await falla(c, `DELETE FROM "CuentaItem" WHERE id = 'ad_a'`), `${etiqueta}: borrar el adicional anda`).toBeNull();
    expect((await c.query(`SELECT id FROM "OpcionElegidaEnLinea" ORDER BY id`)).rows.map((r) => r.id), `${etiqueta}: la foto del adicional se borró con él (cascada)`).toEqual(["fo_a"]);
    expect(await falla(c, `DELETE FROM "CuentaItem" WHERE id = 'it_a'`), `${etiqueta}: borrar el padre ahora anda`).toBeNull();
    expect((await c.query(`SELECT id FROM "OpcionElegidaEnLinea"`)).rows, `${etiqueta}: y su foto se fue con él`).toEqual([]);
  });
  await humo({ lectura: "suc_a,suc_b", escritura: "suc_a" }, async (c) => {
    expect(await falla(c, foto1("fo_b2", "it_b", "gr_leche", "op_vaca", "ver_vaca", "VARIANTE")), `${etiqueta}: con lectura en B y escritura solo en A, una foto en la línea de B da 42501`).toBe("42501");
    expect((await c.query(`SELECT id FROM "OpcionElegidaEnLinea"`)).rows.map((r) => r.id), `${etiqueta}: la foto de B se ve con lectura en B`).toEqual(["fo_b"]);
  });
  expect(await q(`SELECT 1 FROM "OpcionApagadaEnSucursal" WHERE id NOT IN ('ap_b')`), `${etiqueta}: el humo no dejó ningún apagado`).toEqual([]);
  expect(Number((await q<{ n: string }>(`SELECT count(*) AS n FROM "CuentaItem"`))[0]!.n), `${etiqueta}: el humo no dejó ninguna línea de más`).toBe(1);
  await vaciarTablasDeGO1();
}

let antesDeGO1: Awaited<ReturnType<typeof foto>>;
let arribaConGO1: Awaited<ReturnType<typeof foto>>;

describe("GO-1: subir, bajar y subir (grupos de opciones de venta: GO-1a a GO-1d-rls) sobre el estado que deja M7 con todo arriba", () => {
  it("9.0. las seis migraciones existen, son posteriores a M7, van en este orden, avisan que requieren autorización, tienen down.sql (el de GO-1a, GO-1b, GO-1c y GO-1d ABORTA), solo las dos de políticas son de sucursal y las otras no nombran políticas de alcance", () => {
    expect([...GO1].sort()).toEqual(GO1);
    for (const m of GO1) {
      expect(m > M7_4, `${m} es posterior a M7`).toBe(true);
      expect(sql(m, "migration.sql").split("\n")[0], `${m}: avisa que requiere autorización`).toContain("REQUIERE AUTORIZACIÓN EXPRESA");
      expect(sql(m, "down.sql").length, `${m}: tiene down.sql`).toBeGreaterThan(0);
    }
    for (const m of [GO1_A, GO1_B, GO1_C, GO1_D]) {
      expect(sql(m, "down.sql"), `${m}: la reversa ABORTA`).toMatch(/ABORTA/);
      for (const archivo of ["migration.sql", "down.sql"] as const) {
        expect(sql(m, archivo), `${m}/${archivo} no nombra políticas de alcance de sucursal`).not.toContain("alcance_sucursal_");
        expect(sql(m, archivo), `${m}/${archivo} no nombra el ayudante de alcance`).not.toContain("app_sucursales_");
      }
    }
    expect(sql(GO1_B, "down.sql")).toContain('DROP TABLE IF EXISTS "GrupoDeOpciones"');
    expect(sql(GO1_C, "down.sql")).toContain('DROP TABLE IF EXISTS "PrecioLocalDeOpcion"');
    expect(sql(GO1_D, "down.sql")).toContain('DROP TABLE IF EXISTS "OpcionElegidaEnLinea"');
    expect(MIGRACIONES_DE_POLITICAS_POSTERIORES.find((g) => g.migracion === GO1_C_RLS)!.tablas).toEqual(["OpcionApagadaEnSucursal", "PrecioLocalDeOpcion"]);
    expect(MIGRACIONES_DE_POLITICAS_POSTERIORES.find((g) => g.migracion === GO1_D_RLS)!.tablas).toEqual(["OpcionElegidaEnLinea"]);
    for (const m of [GO1_A, GO1_B, GO1_C, GO1_D]) expect(MIGRACIONES_DE_POLITICAS_POSTERIORES.map((g) => g.migracion), m).not.toContain(m);
    for (const m of GO1) expect(MIGRACIONES_DE_POLITICAS_DE_SUCURSAL.map((g) => g.migracion), m).not.toContain(m);
    for (const t of TABLAS_GO1) expect(TABLAS_DEL_PAQUETE_1, t).not.toContain(t);
    expect(TABLAS_DEL_PAQUETE_1).toHaveLength(32);
  });

  it("9.1. SUBIR: GO-1a a GO-1d-rls sobre M7 arriba dejan las nueve tablas, los CHECK, las claves foráneas, los únicos y parciales, las políticas (1 por tabla del catálogo y 5 en las tres de sucursal; el total de alcance pasa a +12), los tres disparadores, los privilegios exactos, las tres claves del admin y un humo como motor2_app", async () => {
    antesDeGO1 = await foto();
    for (const t of TABLAS_GO1) expect(antesDeGO1.rls.find((r) => r.tabla === t), `antes de GO-1 ${t} no existe`).toBeUndefined();
    expect(antesDeGO1.columnas.filter((c) => ["huellaOpciones", "lineaPadreId", "operacionPadreId"].includes(String(c.columna))), "antes de GO-1 no existen las columnas nuevas").toEqual([]);
    for (const m of GO1) await correr(m, "migration.sql");
    await comprobarArribaGO1("primera subida de GO-1");
    arribaConGO1 = await foto();
    expect(arribaConGO1.columnas.length, "sanidad de la foto").toBeGreaterThan(antesDeGO1.columnas.length + 90);
  });

  it("9.2. BAJAR CON DATOS: cada reversa ABORTA por su motivo sin dejar nada a medias; con la foto y los precios arriba la de GO-1b FALLA con 2BP01 y con GO-1d-rls arriba la de B1 también; sin filas, de GO-1d-rls a GO-1a el catálogo queda IDÉNTICO al de antes de GO-1", async () => {
    const c = base.cliente;
    await sembrarOpcionesParaGO1();
    const sinTocar = async (esperado: Awaited<ReturnType<typeof foto>>, motivo: string) => {
      const ahora = await foto();
      for (const k of Object.keys(esperado) as (keyof typeof esperado)[]) expect(ahora[k], `${motivo} no deja nada a medias («${k}»)`).toEqual(esperado[k]);
    };

    // 1) Con GO-1d-rls arriba la reversa de B1 (las funciones de alcance) FALLA por dependencia, entera, sin dejar nada a medias.
    const conGO1 = await foto();
    await expect(correr(MIGRACION_B1_FUNCIONES, "down.sql")).rejects.toMatchObject({ code: "2BP01" });
    await sinTocar(conGO1, "el down de B1 bloqueado");

    // 2) GO-1d-rls pasa (no es destructiva): la foto conserva sus datos y pierde las 4 políticas de sucursal.
    await correr(GO1_D_RLS, "down.sql");
    expect(await q(`SELECT 1 FROM pg_policies WHERE tablename = 'OpcionElegidaEnLinea' AND policyname LIKE 'alcance\\_sucursal\\_%'`), "sin las políticas de sucursal de la foto").toEqual([]);
    expect(Number((await q<{ n: string }>(`SELECT count(*) AS n FROM "OpcionElegidaEnLinea"`))[0]!.n), "la foto sigue").toBe(1);

    // 3) GO-1d ABORTA mientras haya una foto, una línea con huella o con padre, o una operación con padre; cada uno por separado y sin tocar nada.
    const antesDelAborto = await foto();
    await expect(correr(GO1_D, "down.sql")).rejects.toThrow(/No se puede bajar GO-1d: hay 2 línea/);
    await sinTocar(antesDelAborto, "el down de GO-1d con una foto");
    await c.query(`DELETE FROM "OpcionElegidaEnLinea"`);
    await expect(correr(GO1_D, "down.sql")).rejects.toThrow(/No se puede bajar GO-1d: hay 1 línea/);
    await c.query(`DELETE FROM "CuentaItem"`);
    await c.query(`INSERT INTO "Operacion" ("empresaId","id","sucursalId","proceso","fecha","usuarioId") VALUES ('${E}','op_go1_padre','suc_a','VENTA',now(),'u_m4')`);
    await c.query(`INSERT INTO "Operacion" ("empresaId","id","sucursalId","proceso","fecha","usuarioId","operacionPadreId") VALUES ('${E}','op_go1_hija','suc_a','VENTA',now(),'u_m4','op_go1_padre')`);
    const conHija = await foto();
    await expect(correr(GO1_D, "down.sql")).rejects.toThrow(/No se puede bajar GO-1d: hay 1 línea/);
    await sinTocar(conHija, "el down de GO-1d con una operación hija");
    await c.query(`DELETE FROM "Operacion" WHERE "id" LIKE 'op_go1%' AND "operacionPadreId" IS NOT NULL`);
    await c.query(`DELETE FROM "Operacion" WHERE "id" LIKE 'op_go1%'`);
    await correr(GO1_D, "down.sql");
    for (const t of ["OpcionElegidaEnLinea"]) expect(await q(`SELECT 1 FROM pg_class WHERE relname = '${t}' AND relnamespace = 'public'::regnamespace`), `sin la tabla ${t}`).toEqual([]);
    expect(await q(`SELECT 1 FROM pg_trigger WHERE tgname IN ('CuentaItem_opciones_chk', 'OpcionElegidaEnLinea_coherente_chk', 'Operacion_padre_inmutable_chk')`), "sin los tres disparadores").toEqual([]);
    expect(await q(`SELECT column_name FROM information_schema.columns WHERE table_name IN ('CuentaItem', 'Operacion') AND column_name IN ('huellaOpciones', 'lineaPadreId', 'operacionPadreId')`), "sin las tres columnas").toEqual([]);

    // 4) GO-1c-rls pasa; GO-1c ABORTA con precios o apagados cargados.
    await correr(GO1_C_RLS, "down.sql");
    expect(await q(`SELECT 1 FROM pg_policies WHERE tablename = ANY($1) AND policyname LIKE 'alcance\\_sucursal\\_%'`, [POR_SUCURSAL_GO1]), "sin las políticas de sucursal de GO-1").toEqual([]);
    const conPrecios = await foto();
    await expect(correr(GO1_C, "down.sql")).rejects.toThrow(/No se puede bajar GO-1c: hay 2 fila/);
    await sinTocar(conPrecios, "el down de GO-1c con filas");
    await c.query(`DELETE FROM "PrecioLocalDeOpcion"`);
    await c.query(`DELETE FROM "OpcionApagadaEnSucursal"`);

    // 5) GO-1b: con el catálogo cargado ABORTA; vaciado y con GO-1c todavía arriba FALLA con 2BP01 (las tablas de la sucursal lo referencian); bajada GO-1c, pasa.
    const conCatalogo = await foto();
    await expect(correr(GO1_B, "down.sql")).rejects.toThrow(/No se puede bajar GO-1b: hay \d+ fila/);
    await sinTocar(conCatalogo, "el down de GO-1b con catálogo");
    await correr(GO1_C, "down.sql");
    for (const t of ["PrecioLocalDeOpcion", "OpcionApagadaEnSucursal"]) expect(await q(`SELECT 1 FROM pg_class WHERE relname = '${t}' AND relnamespace = 'public'::regnamespace`), `sin la tabla ${t}`).toEqual([]);

    // 6) GO-1a ABORTA con la configuración tocada (y se restaura); con la semilla pura pasa.
    await c.query(`UPDATE "PermisoRol" SET "puedeEditar" = false WHERE "rolId" = 'rol_admin_m4' AND "accionClave" = 'opcion_apagar_en_sucursal'`);
    await expect(correr(GO1_A, "down.sql")).rejects.toThrow(/No se puede bajar GO-1a: hay 1 fila/);
    expect(Number((await q<{ n: string }>(`SELECT count(*) AS n FROM "Accion" WHERE "clave" = ANY($1)`, [CLAVES_GO1]))[0]!.n), "el aborto no borró las claves").toBe(3);
    await c.query(`UPDATE "PermisoRol" SET "puedeEditar" = true WHERE "rolId" = 'rol_admin_m4' AND "accionClave" = 'opcion_apagar_en_sucursal'`);

    // 7) Sin filas en el catálogo: GO-1b pasa (ya no hay nada arriba que lo referencie) y después GO-1a.
    await vaciarTablasDeGO1();
    await correr(GO1_B, "down.sql");
    for (const t of CATALOGO_GO1) expect(await q(`SELECT 1 FROM pg_class WHERE relname = '${t}' AND relnamespace = 'public'::regnamespace`), `sin la tabla ${t}`).toEqual([]);
    await correr(GO1_A, "down.sql");
    expect(await q(`SELECT 1 FROM "Accion" WHERE "clave" = ANY($1)`, [CLAVES_GO1]), "sin las tres claves").toEqual([]);
    expect(await q(`SELECT 1 FROM "PermisoRol" WHERE "accionClave" = ANY($1)`, [CLAVES_GO1]), "sin lo configurado sobre ellas").toEqual([]);

    const despues = await foto();
    for (const k of Object.keys(antesDeGO1) as (keyof typeof antesDeGO1)[]) expect(despues[k], `catálogo «${k}» igual que antes de GO-1`).toEqual(antesDeGO1[k]);
  });

  it("9.2b. con la foto y las tablas de la sucursal arriba pero el catálogo SIN filas, la reversa de GO-1b FALLA con 2BP01 (las claves foráneas de GO-1c y GO-1d), entera y sin dejar nada a medias", async () => {
    for (const m of GO1) await correr(m, "migration.sql");
    const arriba = await foto();
    for (const t of TABLAS_GO1) expect(Number((await q<{ n: string }>(`SELECT count(*) AS n FROM "${t}"`))[0]!.n), `${t} vacía`).toBe(0);
    await expect(correr(GO1_B, "down.sql")).rejects.toMatchObject({ code: "2BP01" });
    const intacta = await foto();
    for (const k of Object.keys(arriba) as (keyof typeof arriba)[]) expect(intacta[k], `el down de GO-1b bloqueado no deja nada a medias («${k}»)`).toEqual(arriba[k]);
    for (const m of BAJADA_GO1) await correr(m, "down.sql");
    const despues = await foto();
    for (const k of Object.keys(antesDeGO1) as (keyof typeof antesDeGO1)[]) expect(despues[k], `catálogo «${k}» igual que antes de GO-1`).toEqual(antesDeGO1[k]);
  });

  it("9.3. SUBIR OTRA VEZ: las mismas comprobaciones, las tablas vuelven vacías y el catálogo es idéntico al de la primera subida", async () => {
    for (const m of GO1) await correr(m, "migration.sql");
    for (const t of TABLAS_GO1) expect(Number((await q<{ n: string }>(`SELECT count(*) AS n FROM "${t}"`))[0]!.n), `${t} volvió vacía`).toBe(0);
    await comprobarArribaGO1("segunda subida de GO-1");
    const otraVez = await foto();
    for (const k of Object.keys(arribaConGO1) as (keyof typeof arribaConGO1)[]) expect(otraVez[k], `catálogo «${k}» igual que la primera vez`).toEqual(arribaConGO1[k]);
  });

  it("9.4. INDEPENDENCIA Y CICLO COMPLETO: con GO-1 arriba, M7, M6 y M5 bajan y suben sin tocar GO-1 (catálogo idéntico); después se baja GO-1, M7, M6, M5, M4 y M3 hasta el Paquete 2 (catálogo idéntico al de entonces) y se sube todo otra vez hasta el mismo catálogo con GO-1 arriba", async () => {
    // Sin datos que las reversas protegen: las tablas de M7 y las notas de M6 (sus down abortan con filas), la de M5 y los gastos (el down de M4.2 aborta si los hay).
    await vaciarTablasDeM7();
    await vaciarLasNotas();
    await base.cliente.query(`DELETE FROM "ReclasificacionRenglon"`);
    await base.cliente.query(`DELETE FROM "ImputacionDeGasto"`);
    await base.cliente.query(`DELETE FROM "FacturaProveedorRenglon" WHERE "naturaleza" = 'SIN_STOCK'`);
    // Independencia: GO-1 no se entera de M5 a M7.
    for (const m of [...BAJADA_M7, ...BAJADA_M6, M5]) await correr(m, "down.sql");
    const sinM5aM7 = await foto();
    for (const t of TABLAS_GO1) expect(sinM5aM7.rls.find((r) => r.tabla === t), `${t} sigue arriba con M5 a M7 abajo`).toEqual({ tabla: t, rls: true, forzado: false });
    const disparadoresDeGO1 = (f: typeof sinM5aM7) => f.disparadores.filter((d) => ["CuentaItem_opciones_chk", "OpcionElegidaEnLinea_coherente_chk", "Operacion_padre_inmutable_chk"].includes(String(d.nombre)));
    const politicasDeGO1 = (f: typeof sinM5aM7) => f.politicas.filter((p) => TABLAS_GO1.includes(String(p.tabla)));
    expect(disparadoresDeGO1(sinM5aM7), "los tres disparadores de GO-1 siguen").toHaveLength(3);
    expect(politicasDeGO1(sinM5aM7), "las 21 políticas de GO-1 siguen (6 del catálogo, 15 de las tres de sucursal)").toHaveLength(21);
    expect(disparadoresDeGO1(sinM5aM7), "los disparadores de GO-1 no cambiaron al bajar M5 a M7").toEqual(disparadoresDeGO1(arribaConGO1));
    expect(politicasDeGO1(sinM5aM7), "las políticas de GO-1 no cambiaron al bajar M5 a M7").toEqual(politicasDeGO1(arribaConGO1));
    for (const m of [M5, ...SUBIDA_M6, ...M7]) await correr(m, "migration.sql");
    const otraVezM5aM7 = await foto();
    for (const k of Object.keys(arribaConGO1) as (keyof typeof arribaConGO1)[]) expect(otraVezM5aM7[k], `catálogo «${k}» igual con GO-1 y M5 a M7 vueltos a subir`).toEqual(arribaConGO1[k]);

    // El ciclo completo.
    for (const m of [...BAJADA_GO1, ...BAJADA_M7, ...BAJADA_M6, M5, ...BAJADA]) await correr(m, "down.sql");
    for (const m of [...M3].reverse()) await correr(m, "down.sql");
    const abajo = await foto();
    for (const k of Object.keys(antesDeM3) as (keyof typeof antesDeM3)[]) expect(abajo[k], `catálogo «${k}» igual que antes de M3`).toEqual(antesDeM3[k]);
    for (const m of [...M3, ...SUBIDA, M5, ...SUBIDA_M6, ...M7, ...GO1]) await correr(m, "migration.sql");
    await comprobarArribaGO1("ciclo completo de GO-1");
    const otraVez = await foto();
    for (const k of Object.keys(arribaConGO1) as (keyof typeof arribaConGO1)[]) expect(otraVez[k], `catálogo «${k}» igual que la primera vez`).toEqual(arribaConGO1[k]);
  });

  it("9.5. Las reversas de GO-1 son idempotentes (IF EXISTS): bajar cada una dos veces no falla, deja el catálogo de antes de GO-1, y volver a subir deja todo arriba", async () => {
    for (const m of BAJADA_GO1) {
      await correr(m, "down.sql");
      await correr(m, "down.sql");
    }
    const abajo = await foto();
    for (const k of Object.keys(antesDeGO1) as (keyof typeof antesDeGO1)[]) expect(abajo[k], `catálogo «${k}» igual que antes de GO-1`).toEqual(antesDeGO1[k]);
    for (const m of GO1) await correr(m, "migration.sql");
    await comprobarArribaGO1("tercera subida de GO-1");
  });
});
