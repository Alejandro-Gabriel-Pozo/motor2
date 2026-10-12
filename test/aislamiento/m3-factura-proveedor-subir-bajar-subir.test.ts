import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";
import { MIGRACIONES_DE_POLITICAS_DE_SUCURSAL, MIGRACIONES_DE_POLITICAS_POSTERIORES, TABLAS_DEL_PAQUETE_1 } from "../setup/migraciones-de-alcance-de-sucursal";
import { COMANDOS_CON_POLITICA_DE_ALCANCE } from "../setup/politicas-de-alcance-de-sucursal";

/**
 * Paquete 3, M3 (M3a, M3b y su recepción, M3c, M3d y M3e): SUBIR, BAJAR y SUBIR de las migraciones reales sobre una base TEMPORAL descartable (`crearBaseTemporalMigrada`: solo Postgres local, jamás `motor2_dev`, `motor2_e2e` ni una base real), con cada
 * `down.sql` tal cual está en el repo. Parte de la base con el Paquete 2 ya aplicado (hasta `20261015123000_m2_rls_sucursal_venta`), que es el estado de producción antes de M3.
 *
 * ATENCIÓN: la reversa de M3b (borra las tres tablas de la factura y la columna del Kardex), la de M3d (borra el desglose de IVA, los tributos y la perilla) y la de M3a (borra la clave de permiso y lo configurado sobre ella) son DESTRUCTIVAS si ya hay datos nuevos; la prueba las corre con datos
 * a propósito, sobre la base temporal, que se borra al terminar.
 *
 * Qué comprueba:
 *  1. ARRIBA (M3a, M3b, M3c y M3d sobre una base con datos previos): la clave de permiso sembrada al admin, las tres tablas con sus reglas, índices (el único parcial de la unicidad del número), claves foráneas, RLS y privilegios EXACTOS
 *     (SELECT e INSERT; UPDATE por columna solo de la lista cerrada de la cabecera), la columna del Kardex en NULL en las filas viejas y la política de sucursal de la parte. Humo como `motor2_app`: la cabecera se ve sin alcance, la
 *     parte no; un INSERT en otra sucursal y un UPDATE del importe dan 42501.
 *  2. ABAJO (M3e, M3d, M3c, la recepción, M3b, M3a, en ese orden; con datos nuevos escritos): el catálogo queda IDÉNTICO al de antes de M3 (columnas, índices, restricciones, políticas, tipos, RLS, privilegios y funciones); las filas que no se borran siguen
 *     (el Kardex pierde solo la referencia al renglón), y lo que se pierde es exactamente lo que dicen los down.sql.
 *  3. ARRIBA OTRA VEZ: las mismas comprobaciones, y el catálogo es idéntico al de la primera subida.
 *  4. Las reversas son idempotentes (IF EXISTS) y la reversa de M3c no toca las políticas del Paquete 1 ni las de Venta.
 */
const RAIZ = join(__dirname, "../../prisma/migrations");
const ULTIMA_DEL_PAQUETE_2 = "20261015123000_m2_rls_sucursal_venta";
const M3A = "20261016100000_permiso_compra_repartir";
const M3B = "20261016101000_factura_proveedor";
const M3B2 = "20261016101500_factura_proveedor_recepcion";
const M3C = "20261016102000_rls_sucursal_factura_proveedor_sucursal";
const M3D = "20261016103000_factura_proveedor_iva";
const M3E = "20261016104000_proveedor_condicion_iva_y_puntos_de_venta";
const SUBIDA = [M3A, M3B, M3B2, M3C, M3D, M3E];
/** La reversa va en orden inverso: M3d (cuelga de las tablas de M3b), M3c ANTES que M3b (la tabla), y M3a al final. */
const BAJADA = [M3E, M3D, M3C, M3B2, M3B, M3A];

const CHECKS_NUEVOS = [
  "FacturaProveedor_nro_pareo_chk", "FacturaProveedor_letra_chk", "FacturaProveedor_importe_total_no_negativo_chk", "FacturaProveedor_estado_chk", "FacturaProveedor_confirmacion_coherente_chk", "FacturaProveedor_origen_chk",
  "FacturaProveedor_pendiente_solo_carga_chk", "FacturaProveedor_condicion_pago_chk", "FacturaProveedor_medio_pago_chk", "FacturaProveedor_pago_declarado_solo_contado_chk", "FacturaProveedor_idempotencia_pareo_chk",
  "FacturaProveedor_anulacion_pareo_chk", "FacturaProveedorRenglon_orden_chk", "FacturaProveedorRenglon_naturaleza_chk", "FacturaProveedorRenglon_pareo_mercaderia_chk", "FacturaProveedorRenglon_cantidad_positiva_chk",
  "FacturaProveedorRenglon_precio_unidad_no_negativo_chk", "FacturaProveedorRenglon_precio_total_no_negativo_chk", "FacturaProveedorSucursal_porcentaje_chk", "MovimientoStock_renglon_solo_compra_chk",
  // M3b, segunda parte: la recepción por sucursal
  "FacturaProveedorSucursal_estado_recepcion_chk", "FacturaProveedorSucursal_recepcion_coherente_chk", "FacturaProveedorSucursal_recibida_por_chk",
  // M3e
  "Proveedor_condicionIva_check", "PuntoDeVentaDeProveedor_numero_chk",
  // M3d
  "FacturaProveedor_condicion_iva_empresa_chk", "FacturaProveedor_desglose_pareo_chk", "FacturaProveedor_desglose_no_negativo_chk", "FacturaProveedor_desglose_dentro_del_total_chk",
  "FacturaProveedorRenglon_alicuota_iva_chk", "FacturaProveedorRenglon_desglose_pareo_chk", "FacturaProveedorRenglon_desglose_no_negativo_chk", "FacturaProveedorRenglon_neto_mas_iva_chk",
  "FacturaProveedorRenglon_alicuota_sin_iva_chk", "FacturaProveedorRenglon_iva_computable_chk", "FacturaProveedorTributo_tipo_chk", "FacturaProveedorTributo_importe_positivo_chk",
];
const UNICOS_NUEVOS = [
  "FacturaProveedor_empresaId_id_key", "FacturaProveedor_claveIdempotencia_key", "FacturaProveedor_unica_vigente_key", "FacturaProveedorRenglon_empresaId_id_key", "FacturaProveedorRenglon_facturaProveedorId_orden_key",
  "FacturaProveedorSucursal_empresaId_id_key", "FacturaProveedorSucursal_facturaProveedorId_sucursalId_key", "FacturaProveedorSucursal_empresaId_operacionId_key", "FacturaProveedorTributo_empresaId_id_key",
  "PuntoDeVentaDeProveedor_empresaId_id_key", "PuntoDeVentaDeProveedor_proveedorId_numero_key",
];
const CLAVES_FORANEAS_NUEVAS = [
  "FacturaProveedor_empresaId_fkey", "FacturaProveedor_empresaId_proveedorId_fkey", "FacturaProveedor_creadoPorId_fkey", "FacturaProveedor_confirmadaPorId_fkey", "FacturaProveedor_anuladaPorId_fkey",
  "FacturaProveedorRenglon_empresaId_fkey", "FacturaProveedorRenglon_empresaId_facturaProveedorId_fkey", "FacturaProveedorRenglon_empresaId_productoId_fkey", "FacturaProveedorSucursal_empresaId_fkey",
  "FacturaProveedorSucursal_empresaId_facturaProveedorId_fkey", "FacturaProveedorSucursal_empresaId_sucursalId_fkey", "FacturaProveedorSucursal_empresaId_operacionId_fkey", "MovimientoStock_empresaId_facturaProveedorRenglonId_fkey",
  "FacturaProveedorTributo_empresaId_fkey", "FacturaProveedorTributo_empresaId_facturaProveedorId_fkey", "FacturaProveedorSucursal_recibidaPorId_fkey",
  "PuntoDeVentaDeProveedor_empresaId_fkey", "PuntoDeVentaDeProveedor_empresaId_proveedorId_fkey",
];
const TABLAS_NUEVAS = ["FacturaProveedor", "FacturaProveedorRenglon", "FacturaProveedorSucursal", "FacturaProveedorTributo", "PuntoDeVentaDeProveedor"];
/** M3d: las columnas nuevas (la perilla de la empresa, el desglose de IVA) y su nulabilidad. */
const COLUMNAS_DE_IVA: ReadonlyArray<[string, string, "YES" | "NO", string | null]> = [
  ["Empresa", "llevaIvaDeCompras", "NO", "false"],
  // M3e: la condición del proveedor
  ["Proveedor", "condicionIva", "YES", null],
  ["FacturaProveedor", "condicionIvaEmpresa", "YES", null],
  ["FacturaProveedor", "importeNeto", "YES", null],
  ["FacturaProveedor", "importeIva", "YES", null],
  ["FacturaProveedorRenglon", "alicuotaIva", "YES", null],
  ["FacturaProveedorRenglon", "importeNeto", "YES", null],
  ["FacturaProveedorRenglon", "importeIva", "YES", null],
  ["FacturaProveedorRenglon", "importeIvaComputable", "NO", "0"],
  // M3b, segunda parte: la recepción
  ["FacturaProveedorSucursal", "estadoRecepcion", "NO", "'PENDIENTE'::text"],
  ["FacturaProveedorSucursal", "recibidaEn", "YES", null],
  ["FacturaProveedorSucursal", "recibidaPorId", "YES", null],
];
const COLUMNAS_ACTUALIZABLES = [
  "anuladaEn", "anuladaPorId", "confirmadaEn", "confirmadaPorId", "detalleLibre", "estado", "fechaComprobante", "fechaPagoDeclarada", "letra", "medioPagoDeclarado", "nroFactura", "nroFacturaNormalizado",
  "proveedorId", "recibidaEnAdministracionEn", "resultadoMensaje",
];

const E = "empresa_m3";
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
    disparadores: await q(`SELECT tgrelid::regclass::text AS tabla, tgname::text AS nombre, tgenabled::text AS habilitado, pg_get_triggerdef(oid) AS definicion FROM pg_trigger WHERE NOT tgisinternal ORDER BY 1, 2`),
    privilegiosDeColumna: await q(`SELECT table_name::text AS tabla, column_name::text AS columna, grantee::text AS rol, privilege_type FROM information_schema.column_privileges WHERE table_schema = 'public' AND grantee IN ('motor2_app', 'motor2_plataforma') AND (table_name LIKE 'FacturaProveedor%' OR table_name = 'PuntoDeVentaDeProveedor') ORDER BY 1, 2, 3, 4`),
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

/** Una cabecera mínima. Como `motor2_app` la empresa sale del contexto (default); como dueño, que no tiene contexto, se indica. */
const insertarCabecera = (id: string, empresa?: string, extra = "") =>
  `INSERT INTO "FacturaProveedor" (${empresa ? '"empresaId",' : ""}"id","proveedorId","fecha","importeTotal","estado","confirmadaEn","confirmadaPorId","creadoPorId"${extra ? ',"nroFactura","nroFacturaNormalizado"' : ""}) VALUES (${empresa ? `'${empresa}',` : ""}'${id}','prov_m3','2026-09-01T15:00:00Z','100.00','CONFIRMADA',now(),'u_m3','u_m3'${extra ? `,'${extra}','${extra}'` : ""})`;
const insertarParte = (id: string, facturaId: string, sucursalId: string, empresa?: string) =>
  `INSERT INTO "FacturaProveedorSucursal" (${empresa ? '"empresaId",' : ""}"id","facturaProveedorId","sucursalId","porcentajeDeclaradoBp") VALUES (${empresa ? `'${empresa}',` : ""}'${id}','${facturaId}','${sucursalId}',5000)`;

/** Las comprobaciones de «todo aplicado». */
async function comprobarArriba(etiqueta: string) {
  const f = await foto();
  const conNombre = (lista: Array<Record<string, unknown>>, campo: string) => lista.map((x) => String(x[campo]));

  // M3a: la clave y su siembra al admin (y a nadie más).
  expect(await q(`SELECT "clave" FROM "Accion" WHERE "clave" = 'compra_repartir'`), `${etiqueta}: la clave existe`).toEqual([{ clave: "compra_repartir" }]);
  expect(await q(`SELECT "rolId" FROM "PermisoRol" WHERE "accionClave" = 'compra_repartir' ORDER BY 1`), `${etiqueta}: solo el admin la tiene`).toEqual([{ rolId: "rol_admin_m3" }]);
  expect(await q(`SELECT "clave" FROM "Accion" WHERE "clave" = 'compra_recibir'`), `${etiqueta}: la clave de recibir existe`).toEqual([{ clave: "compra_recibir" }]);
  expect(await q(`SELECT "rolId" FROM "PermisoRol" WHERE "accionClave" = 'compra_recibir' ORDER BY 1`), `${etiqueta}: solo el admin tiene la de recibir`).toEqual([{ rolId: "rol_admin_m3" }]);
  expect((await q<{ nombre: string }>(`SELECT tgname::text AS nombre FROM pg_trigger WHERE tgrelid = '"FacturaProveedorSucursal"'::regclass AND NOT tgisinternal`)).map((t) => t.nombre), `${etiqueta}: el disparador de la recepción`).toEqual(["FacturaProveedorSucursal_recepcion_transicion_chk"]);
  expect((await q<{ columna: string }>(`SELECT a.attname::text AS columna FROM pg_attribute a WHERE a.attrelid = '"FacturaProveedorSucursal"'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('motor2_app', a.attrelid, a.attnum, 'UPDATE') ORDER BY 1`)).map((c) => c.columna), `${etiqueta}: UPDATE de la parte solo en la recepción`).toEqual(["estadoRecepcion", "recibidaEn", "recibidaPorId"]);

  // M3b: tablas, columna del Kardex, reglas, índices, claves foráneas.
  for (const t of TABLAS_NUEVAS) expect(f.rls.find((r) => r.tabla === t), `${etiqueta}: ${t} con RLS`).toEqual({ tabla: t, rls: true, forzado: false });
  const columna = f.columnas.find((x) => x.tabla === "MovimientoStock" && x.columna === "facturaProveedorRenglonId");
  expect(columna, `${etiqueta}: existe MovimientoStock.facturaProveedorRenglonId`).toBeDefined();
  expect([columna!.is_nullable, columna!.column_default], `${etiqueta}: NULLABLE y sin valor por defecto`).toEqual(["YES", null]);
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
  expect(String(f.indices.find((x) => x.nombre === "FacturaProveedor_unica_vigente_key")!.indexdef), `${etiqueta}: el índice de la unicidad es parcial`).toMatch(/WHERE .*"nroFacturaNormalizado" IS NOT NULL.*"anuladaEn" IS NULL/);

  // Privilegios exactos: SELECT e INSERT (nunca DELETE) para motor2_app; nada para motor2_plataforma; UPDATE solo por columna y solo de la lista cerrada.
  for (const t of TABLAS_NUEVAS) {
    expect(f.privilegios.filter((p) => p.tabla === t), `${etiqueta}: ${t}: solo se agrega`).toEqual([{ tabla: t, rol: "motor2_app", privilege_type: "INSERT" }, { tabla: t, rol: "motor2_app", privilege_type: "SELECT" }]);
  }
  const actualizables = await q<{ columna: string }>(
    `SELECT a.attname::text AS columna FROM pg_attribute a WHERE a.attrelid = '"FacturaProveedor"'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('motor2_app', a.attrelid, a.attnum, 'UPDATE') ORDER BY 1`,
  );
  expect(actualizables.map((c) => c.columna), `${etiqueta}: UPDATE por columna, solo la lista cerrada`).toEqual([...COLUMNAS_ACTUALIZABLES].sort());

  // M3d: la perilla (apagada para toda empresa) y el desglose de IVA (nullable, salvo el computable en 0).
  for (const [tabla, columnaNueva, nulable, porDefecto] of COLUMNAS_DE_IVA) {
    const fila = f.columnas.find((x) => x.tabla === tabla && x.columna === columnaNueva);
    expect(fila, `${etiqueta}: existe ${tabla}.${columnaNueva}`).toBeDefined();
    expect([fila!.is_nullable, fila!.column_default], `${etiqueta}: ${tabla}.${columnaNueva}`).toEqual([nulable, porDefecto]);
  }
  expect(await q(`SELECT "llevaIvaDeCompras" FROM "Empresa" WHERE id = $1`, [E]), `${etiqueta}: la perilla nace apagada`).toEqual([{ llevaIvaDeCompras: false }]);
  expect(f.politicas.filter((p) => p.tabla === "FacturaProveedorTributo").map((p) => p.nombre), `${etiqueta}: los tributos, solo con la política de empresa`).toEqual(["aislamiento_empresa"]);

  // M3e: la condición del proveedor queda «no declarada» en los proveedores de antes; los puntos de venta, DE EMPRESA, con UPDATE solo de `activo`.
  expect(await q(`SELECT "condicionIva" FROM "Proveedor" WHERE id = 'prov_m3'`), `${etiqueta}: el proveedor de antes queda sin condición declarada`).toEqual([{ condicionIva: null }]);
  expect(f.politicas.filter((p) => p.tabla === "PuntoDeVentaDeProveedor").map((p) => p.nombre), `${etiqueta}: los puntos de venta, solo con la política de empresa`).toEqual(["aislamiento_empresa"]);
  expect((await q<{ columna: string }>(`SELECT a.attname::text AS columna FROM pg_attribute a WHERE a.attrelid = '"PuntoDeVentaDeProveedor"'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('motor2_app', a.attrelid, a.attnum, 'UPDATE') ORDER BY 1`)).map((c) => c.columna), `${etiqueta}: UPDATE de los puntos de venta solo en activo`).toEqual(["activo"]);

  // M3c: la política de sucursal de la parte y las anteriores intactas.
  const deAlcance = f.politicas.filter((p) => String(p.nombre).startsWith("alcance_sucursal_"));
  const deLaParte = deAlcance.filter((p) => p.tabla === "FacturaProveedorSucursal");
  expect(deLaParte.map((p) => p.cmd).sort(), `${etiqueta}: 4 políticas de sucursal en la parte`).toEqual(["DELETE", "INSERT", "SELECT", "UPDATE"]);
  for (const p of deLaParte) expect([p.permissive, p.roles], `${etiqueta}: ${p.nombre} RESTRICTIVE para motor2_app`).toEqual(["RESTRICTIVE", "{motor2_app}"]);
  expect(deAlcance, `${etiqueta}: 128 del Paquete 1 + 4 de Venta + 4 de la parte`).toHaveLength(TABLAS_DEL_PAQUETE_1.length * COMANDOS_CON_POLITICA_DE_ALCANCE.length + 8);
  for (const t of ["FacturaProveedor", "FacturaProveedorRenglon"]) expect(f.politicas.filter((p) => p.tabla === t).map((p) => p.nombre), `${etiqueta}: ${t} solo con la política de empresa`).toEqual(["aislamiento_empresa"]);

  // Las filas viejas siguen y la columna nueva del Kardex quedó en NULL.
  const viejas = await q<{ id: string; nulo: boolean }>(`SELECT id, "facturaProveedorRenglonId" IS NULL AS nulo FROM "MovimientoStock" WHERE id = 'mov_viejo'`);
  expect(viejas, `${etiqueta}: el movimiento previo a M3 sigue, sin renglón`).toEqual([{ id: "mov_viejo", nulo: true }]);

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
  await base.cliente.query(`DELETE FROM "FacturaProveedorSucursal" WHERE id IN ('parte_a', 'parte_b')`);
  await base.cliente.query(`DELETE FROM "FacturaProveedor" WHERE id = 'fact_humo'`);
  await base.cliente.query(insertarCabecera("fact_humo", E));
  await base.cliente.query(insertarParte("parte_a", "fact_humo", "suc_a", E));
  await base.cliente.query(insertarParte("parte_b", "fact_humo", "suc_b", E));
  await comoApp({}, async (c) => {
    expect((await c.query(`SELECT id FROM "FacturaProveedor"`)).rows, `${etiqueta}: la cabecera (de empresa) se ve aun sin alcance`).toEqual([{ id: "fact_humo" }]);
    expect((await c.query(`SELECT id FROM "FacturaProveedorSucursal"`)).rows, `${etiqueta}: sin alcance no se ve ninguna parte (falla cerrado)`).toEqual([]);
  });
  await comoApp({ lectura: "suc_a", escritura: "suc_a" }, async (c) => {
    expect((await c.query(`SELECT id FROM "FacturaProveedorSucursal" ORDER BY id`)).rows, `${etiqueta}: con la sucursal A solo se ve la parte de A`).toEqual([{ id: "parte_a" }]);
    expect((await c.query(`SELECT id FROM "FacturaProveedor"`)).rows, `${etiqueta}: la cabecera se ve desde cualquier sucursal`).toEqual([{ id: "fact_humo" }]);
    expect(await falla(c, insertarCabecera("fact_nueva")), `${etiqueta}: insertar una cabecera anda`).toBeNull();
    expect(await falla(c, insertarParte("parte_ajena", "fact_humo", "suc_b")), `${etiqueta}: insertar la parte de otra sucursal da 42501`).toBe("42501");
    expect(await falla(c, `UPDATE "FacturaProveedor" SET "importeTotal" = '0.01' WHERE id = 'fact_humo'`), `${etiqueta}: UPDATE del importe da 42501`).toBe("42501");
    expect(await falla(c, `UPDATE "FacturaProveedor" SET "anuladaEn" = now(), "anuladaPorId" = 'u_m3' WHERE id = 'fact_humo'`), `${etiqueta}: anular anda`).toBeNull();
    expect(await falla(c, `DELETE FROM "FacturaProveedor" WHERE id = 'fact_humo'`), `${etiqueta}: DELETE da 42501`).toBe("42501");
    expect(await falla(c, `DELETE FROM "FacturaProveedorSucursal" WHERE id = 'parte_a'`), `${etiqueta}: DELETE de la parte da 42501`).toBe("42501");
    expect(await falla(c, `UPDATE "FacturaProveedorSucursal" SET "porcentajeDeclaradoBp" = 1 WHERE id = 'parte_a'`), `${etiqueta}: UPDATE del porcentaje da 42501`).toBe("42501");
    expect(await falla(c, `UPDATE "FacturaProveedorSucursal" SET "estadoRecepcion" = 'RECIBIDA', "recibidaEn" = now(), "recibidaPorId" = 'u_m3' WHERE id = 'parte_a' AND "estadoRecepcion" = 'PENDIENTE'`), `${etiqueta}: confirmar la recepción anda`).toBeNull();
    expect(await falla(c, `UPDATE "FacturaProveedorSucursal" SET "estadoRecepcion" = 'PENDIENTE', "recibidaEn" = NULL, "recibidaPorId" = NULL WHERE id = 'parte_a'`), `${etiqueta}: una recibida no vuelve atrás (23514, disparador)`).toBe("23514");
  });
}

let antesDeM3: Awaited<ReturnType<typeof foto>>;
let arribaLaPrimeraVez: Awaited<ReturnType<typeof foto>>;

beforeAll(async () => {
  base = await crearBaseTemporalMigrada();
  hayRol = (await base.cliente.query("SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app'")).rowCount === 1;
  if (!hayRol) return; // sin el rol, `CREATE POLICY … TO motor2_app` falla: el archivo omite sus casos con motivo (como los demás tests de RLS).
  await base.aplicarHasta(ULTIMA_DEL_PAQUETE_2);
  await base.cliente.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO motor2_app`);
  // Datos que existen ANTES de M3 y que ninguna reversa borra: una empresa con dos sucursales, un usuario, un proveedor, un producto, su rol admin (y uno que no lo es) y una compra con su movimiento.
  const c = base.cliente;
  await c.query(`INSERT INTO "Empresa" ("id","nombre","slug","zonaHoraria","moneda","estado") VALUES ($1,$1,$1,'America/Argentina/Buenos_Aires','ARS','ACTIVE')`, [E]);
  await c.query(`INSERT INTO "Sucursal" ("id","empresaId","nombre") VALUES ('suc_a',$1,'Centro'), ('suc_b',$1,'Norte')`, [E]);
  await c.query(`INSERT INTO "User" ("id","email") VALUES ('u_m3','m3@ejemplo.test')`);
  await c.query(`INSERT INTO "Rol" ("id","empresaId","nombre","clave") VALUES ('rol_admin_m3',$1,'admin','admin'), ('rol_otro_m3',$1,'encargado',NULL)`, [E]);
  await c.query(`INSERT INTO "Proveedor" ("id","empresaId","codigo","nombre") VALUES ('prov_m3',$1,'PRV_M3','Proveedor')`, [E]);
  await c.query(`INSERT INTO "Unidad" ("id","empresaId","nombre","magnitud") VALUES ('uni_m3',$1,'kg','PESO')`, [E]);
  await c.query(`INSERT INTO "Producto" ("id","empresaId","codigo","nombre","tipo","unidadStockId") VALUES ('pro_m3',$1,'MP_M3','Harina','MP','uni_m3')`, [E]);
  await c.query(`INSERT INTO "Seccion" ("id","empresaId","sucursalId","nombre") VALUES ('sec_m3',$1,'suc_a','Depósito')`, [E]);
  await c.query(`INSERT INTO "Operacion" ("id","empresaId","sucursalId","proceso","fecha","usuarioId","proveedorId") VALUES ('op_compra_vieja',$1,'suc_a','COMPRA',now(),'u_m3','prov_m3')`, [E]);
  await c.query(
    `INSERT INTO "MovimientoStock" ("id","empresaId","operacionId","productoId","seccionId","proceso","cantidad","detalle","precioTotal","precioPorUnidadStock") VALUES ('mov_viejo',$1,'op_compra_vieja','pro_m3','sec_m3','COMPRA',10,'d','100.00','10')`,
    [E],
  );
  antesDeM3 = await foto();
}, 120_000);

afterAll(async () => {
  await app?.end().catch(() => undefined);
  await base?.eliminar();
});

describe("M3: subir, bajar y subir (M3a a M3e, con la recepción entre M3b y M3c) sobre una base temporal con el Paquete 2 aplicado", () => {
  it("0. las seis migraciones existen, son posteriores al Paquete 2, van en este orden y la última está declarada como política posterior", () => {
    expect([...SUBIDA].sort()).toEqual(SUBIDA);
    for (const m of SUBIDA) {
      expect(m > ULTIMA_DEL_PAQUETE_2, `${m} es posterior al Paquete 2`).toBe(true);
      expect(sql(m, "migration.sql").split("\n")[0], `${m}: avisa que requiere autorización`).toContain("REQUIERE AUTORIZACIÓN EXPRESA");
      expect(sql(m, "down.sql").length, `${m}: tiene down.sql`).toBeGreaterThan(0);
    }
    expect(MIGRACIONES_DE_POLITICAS_POSTERIORES.map((g) => g.migracion)).toContain(M3C);
    expect(MIGRACIONES_DE_POLITICAS_DE_SUCURSAL.map((g) => g.migracion)).not.toContain(M3C);
  });

  it("1. SUBIR: M3a a M3e sobre una base con datos previos dejan todo arriba (clave sembrada, tablas, reglas, índices, privilegios exactos, política de sucursal de la parte, perilla y desglose de IVA) y andan como motor2_app", async (ctx) => {
    if (!hayRol) return ctx.skip();
    for (const m of SUBIDA) await correr(m, "migration.sql");
    await comprobarArriba("primera subida");
    arribaLaPrimeraVez = await foto();
    expect(arribaLaPrimeraVez.columnas.length, "sanidad de la foto").toBeGreaterThan(antesDeM3.columnas.length + 40);
  });

  it("2. BAJAR (con datos nuevos escritos): M3e, M3d, M3c, la recepción, M3b y M3a en orden inverso dejan el catálogo como estaba antes de M3; las filas previas siguen y se pierde justo lo que dicen los down.sql", async (ctx) => {
    if (!hayRol) return ctx.skip();
    // Datos que solo existen por M3 (escritos por el dueño): una factura repartida con un renglón, dos partes, y una línea nueva del Kardex que cuelga del renglón.
    const c = base.cliente;
    await c.query(`DELETE FROM "FacturaProveedorSucursal"`);
    await c.query(`DELETE FROM "FacturaProveedor"`);
    await c.query(insertarCabecera("fact_real", E, "0001-00000001"));
    await c.query(
      `INSERT INTO "FacturaProveedorRenglon" ("id","empresaId","facturaProveedorId","orden","productoId","cantidadStock","precioPorUnidadStock","detalle","precioTotal") VALUES ('reng_real',$1,'fact_real',1,'pro_m3',10,10,'10 kg','100.00')`,
      [E],
    );
    await c.query(`INSERT INTO "FacturaProveedorSucursal" ("id","empresaId","facturaProveedorId","sucursalId","porcentajeDeclaradoBp","operacionId") VALUES ('parte_real',$1,'fact_real','suc_a',10000,'op_compra_vieja')`, [E]);
    await c.query(`UPDATE "FacturaProveedorSucursal" SET "estadoRecepcion" = 'RECIBIDA', "recibidaEn" = now(), "recibidaPorId" = 'u_m3' WHERE id = 'parte_real'`);
    await c.query(
      `INSERT INTO "MovimientoStock" ("id","empresaId","operacionId","productoId","seccionId","proceso","cantidad","detalle","precioTotal","precioPorUnidadStock","facturaProveedorRenglonId") VALUES ('mov_nuevo',$1,'op_compra_vieja','pro_m3','sec_m3','COMPRA',10,'d','100.00','10','reng_real')`,
      [E],
    );
    // Y los de M3d: un desglose de IVA en la cabecera y el renglón, un tributo y la perilla prendida.
    await c.query(`UPDATE "FacturaProveedor" SET "condicionIvaEmpresa" = 'RESPONSABLE_INSCRIPTO', "importeNeto" = '82.64', "importeIva" = '17.36' WHERE id = 'fact_real'`);
    await c.query(`UPDATE "FacturaProveedorRenglon" SET "alicuotaIva" = 'IVA_21', "importeNeto" = '82.64', "importeIva" = '17.36', "importeIvaComputable" = '17.36' WHERE id = 'reng_real'`);
    await c.query(`INSERT INTO "FacturaProveedorTributo" ("id","empresaId","facturaProveedorId","tipo","importe") VALUES ('trib_real',$1,'fact_real','PERCEPCION_IIBB','3.00')`, [E]);
    await c.query(`UPDATE "Empresa" SET "llevaIvaDeCompras" = true WHERE id = $1`, [E]);
    // Y los de M3e: la condición del proveedor y un punto de venta.
    await c.query(`UPDATE "Proveedor" SET "condicionIva" = 'RESPONSABLE_INSCRIPTO' WHERE id = 'prov_m3'`);
    await c.query(`INSERT INTO "PuntoDeVentaDeProveedor" ("id","empresaId","proveedorId","numero") VALUES ('pv_real',$1,'prov_m3',12)`, [E]);
    expect(Number((await q<{ n: string }>(`SELECT count(*) AS n FROM "FacturaProveedor"`))[0]!.n), "hay facturas que la reversa va a perder").toBeGreaterThan(0);

    for (const m of BAJADA) await correr(m, "down.sql");
    const despues = await foto();
    for (const k of Object.keys(antesDeM3) as (keyof typeof antesDeM3)[]) expect(despues[k], `catálogo «${k}» igual que antes de M3`).toEqual(antesDeM3[k]);
    for (const t of TABLAS_NUEVAS) expect(await q(`SELECT 1 FROM pg_class WHERE relname = '${t}' AND relnamespace = 'public'::regnamespace`), `sin la tabla ${t}`).toEqual([]);
    expect((await q<{ id: string }>(`SELECT id FROM "MovimientoStock" ORDER BY id`)).map((m) => m.id), "el Kardex sigue (también la línea escrita con M3): la reversa borra la columna, no filas").toEqual(["mov_nuevo", "mov_viejo"]);
    expect(await q(`SELECT 1 FROM "Accion" WHERE "clave" = 'compra_repartir'`), "sin la clave").toEqual([]);
    expect(await q(`SELECT 1 FROM "PermisoRol" WHERE "accionClave" = 'compra_repartir'`), "sin lo configurado sobre la clave").toEqual([]);
    expect(Number((await q<{ n: string }>(`SELECT count(*) AS n FROM "Rol"`))[0]!.n), "los roles siguen").toBe(2);
    expect(Number((await q<{ n: string }>(`SELECT count(*) AS n FROM "Proveedor" WHERE id = 'prov_m3'`))[0]!.n), "el proveedor sigue (la reversa borra la condición, no la fila)").toBe(1);
    expect(Number((await q<{ n: string }>(`SELECT count(*) AS n FROM "Empresa" WHERE id = $1`, [E]))[0]!.n), "la empresa sigue (la reversa borra la perilla, no la fila)").toBe(1);
  });

  it("3. SUBIR OTRA VEZ: las mismas comprobaciones, el catálogo es idéntico al de la primera subida y lo que se perdió (facturas, referencia al renglón, tributos, desglose de IVA, perilla, condición del proveedor y puntos de venta) quedó vacío o sin declarar", async (ctx) => {
    if (!hayRol) return ctx.skip();
    for (const m of SUBIDA) await correr(m, "migration.sql");
    for (const t of TABLAS_NUEVAS) expect(Number((await q<{ n: string }>(`SELECT count(*) AS n FROM "${t}"`))[0]!.n), `${t} volvió vacía`).toBe(0);
    expect((await q<{ n: string }>(`SELECT count(*) AS n FROM "MovimientoStock" WHERE "facturaProveedorRenglonId" IS NOT NULL`))[0]!.n, "ninguna línea cuelga de un renglón").toBe("0");
    await comprobarArriba("segunda subida");
    const otraVez = await foto();
    for (const k of Object.keys(arribaLaPrimeraVez) as (keyof typeof arribaLaPrimeraVez)[]) expect(otraVez[k], `catálogo «${k}» igual que la primera vez`).toEqual(arribaLaPrimeraVez[k]);
  });

  it("4. Las reversas son idempotentes (IF EXISTS): bajar dos veces no falla; bajar solo M3c deja la parte con la RLS de empresa y las políticas anteriores intactas; y volver a subir deja todo arriba", async (ctx) => {
    if (!hayRol) return ctx.skip();
    await correr(M3C, "down.sql");
    await correr(M3C, "down.sql");
    const politicas = await q<{ tabla: string; nombre: string }>(`SELECT tablename::text AS tabla, policyname::text AS nombre FROM pg_policies WHERE schemaname = 'public' AND tablename = 'FacturaProveedorSucursal'`);
    expect(politicas, "la parte queda solo con la política de empresa").toEqual([{ tabla: "FacturaProveedorSucursal", nombre: "aislamiento_empresa" }]);
    const deAlcance = await q(`SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND policyname LIKE 'alcance\\_sucursal\\_%'`);
    expect(deAlcance, "las del Paquete 1 y las de Venta siguen").toHaveLength(TABLAS_DEL_PAQUETE_1.length * COMANDOS_CON_POLITICA_DE_ALCANCE.length + 4);
    await correr(M3C, "migration.sql");
    for (const m of BAJADA) {
      await correr(m, "down.sql");
      await correr(m, "down.sql");
    }
    const despues = await foto();
    for (const k of Object.keys(antesDeM3) as (keyof typeof antesDeM3)[]) expect(despues[k], `catálogo «${k}» igual que antes de M3`).toEqual(antesDeM3[k]);
    for (const m of SUBIDA) await correr(m, "migration.sql");
    await comprobarArriba("tercera subida");
  });
});
