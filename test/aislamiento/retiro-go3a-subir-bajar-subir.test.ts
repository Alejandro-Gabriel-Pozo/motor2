import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";

/**
 * Ola «precio y carta», Fase 3, paso 3.7 (REQUIERE AUTORIZACIÓN EXPRESA PARA APLICARSE; ADR-032, «Fase 3: retiro de GO-3a»): SUBIR, BAJAR y SUBIR la migración de RETIRO de GO-3a
 * (`20261022100000_retiro_go3a_rls` y `20261022101000_retiro_go3a`) sobre una base TEMPORAL que se fue migrando como una real (todas las migraciones anteriores a GO-3a aplicadas, con datos de
 * antes: una empresa con dos sucursales, su admin y otro rol, un producto con un grupo de opciones admitido y una línea de una mesa en cada sucursal). Fija:
 *  - SUBIR el retiro deja el catálogo IDÉNTICO al de antes de GO-3a (columnas, índices, restricciones, políticas, RLS, privilegios de tabla y de columna, disparadores, funciones, las claves de
 *    `Accion` y las filas de `PermisoRol`): el retiro deshace exactamente lo que GO-3a agregó, y nada más;
 *  - con CUALQUIER motivo de bloqueo (una fila en cualquiera de las seis tablas, un eje declarado, la clave delegada a otro rol, el admin sin Ver o sin Editar, una capacidad por sucursal) la migración
 *    de esquema ABORTA sin tocar nada;
 *  - BAJAR (el down.sql del esquema y después el de las políticas) deja el catálogo IDÉNTICO al de GO-3a aplicada (sin datos: se vuelve a crear todo vacío);
 *  - SUBIR OTRA VEZ: idéntico al de antes de GO-3a;
 *  - un humo como `motor2_app` con la RLS real: `ProductoAdmiteGrupo` se lee y se escribe; `GrupoDePrecio` ya no existe (42P01).
 * Contra Postgres local; nunca contra una base real.
 *
 * Mutaciones demostradas (rojas y revertidas): sacar el bloque que aborta (rojo: «aborta con una fila»); omitir el `DROP COLUMN` (rojo: la foto no es la de antes); omitir en la reversa el
 * `GRANT UPDATE ("ejeDeCombinacion")` (rojo: la foto no es la de GO-3a).
 */
const RAIZ = join(__dirname, "../../prisma/migrations");
const GO3_A = "20261021110000_go3a_combinaciones";
const GO3_A_RLS = "20261021111000_go3a_rls_sucursal_combinaciones";
const RETIRO_RLS = "20261022100000_retiro_go3a_rls";
const RETIRO = "20261022101000_retiro_go3a";
const E = "empresa_retiro";
const TABLAS = ["GrupoDePrecio", "CombinacionDeProducto", "PrecioLocalDeCombinacion", "RecetaDeCombinacionVersion", "RecetaDeCombinacionIngrediente", "CombinacionEnLinea"];

const sql = (migracion: string, archivo: "migration.sql" | "down.sql") => readFileSync(join(RAIZ, migracion, archivo), "utf8");
let base: BaseTemporalMigrada;
let hayRol = false;
const abiertas: Client[] = [];

const correr = (migracion: string, archivo: "migration.sql" | "down.sql") => base.cliente.query(sql(migracion, archivo));
const q = <T extends object = Record<string, unknown>>(texto: string, params: unknown[] = []) => base.cliente.query<T>(texto, params).then((r) => r.rows);

/** Una foto del catálogo de `public` (lo que una migración puede tocar) y de las claves y permisos. */
async function foto() {
  return {
    columnas: await q(`SELECT table_name::text AS tabla, column_name::text AS columna, data_type, is_nullable, column_default, numeric_precision, numeric_scale FROM information_schema.columns WHERE table_schema = 'public' ORDER BY 1, ordinal_position`),
    indices: await q(`SELECT tablename::text AS tabla, indexname::text AS nombre, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY 1, 2`),
    restricciones: await q(`SELECT conrelid::regclass::text AS tabla, conname::text AS nombre, contype, convalidated, pg_get_constraintdef(oid) AS definicion FROM pg_constraint WHERE connamespace = 'public'::regnamespace ORDER BY 1, 2`),
    politicas: await q(`SELECT tablename::text AS tabla, policyname::text AS nombre, permissive, roles::text AS roles, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public' ORDER BY 1, 2`),
    rls: await q(`SELECT relname::text AS tabla, relrowsecurity AS rls, relforcerowsecurity AS forzado FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' ORDER BY 1`),
    privilegios: await q(`SELECT table_name::text AS tabla, grantee::text AS rol, privilege_type FROM information_schema.role_table_grants WHERE table_schema = 'public' AND grantee IN ('motor2_app', 'motor2_plataforma') ORDER BY 1, 2, 3`),
    privilegiosDeColumna: await q(`SELECT table_name::text AS tabla, column_name::text AS columna, grantee::text AS rol, privilege_type FROM information_schema.column_privileges WHERE table_schema = 'public' AND grantee IN ('motor2_app', 'motor2_plataforma') ORDER BY 1, 2, 3, 4`),
    disparadores: await q(`SELECT tgrelid::regclass::text AS tabla, tgname::text AS nombre, pg_get_triggerdef(oid) AS definicion FROM pg_trigger WHERE NOT tgisinternal ORDER BY 1, 2`),
    funciones: await q(`SELECT p.proname::text AS nombre, pg_get_functiondef(p.oid) AS definicion FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace ORDER BY 1`),
    acciones: await q(`SELECT "clave", "descripcion" FROM "Accion" ORDER BY 1`),
    permisos: await q(`SELECT "rolId", "accionClave", "puedeVer", "puedeEditar" FROM "PermisoRol" ORDER BY 1, 2`),
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

/** Que la migración de esquema del retiro ABORTÓ con su mensaje y no dejó nada a medias (el catálogo y los datos de antes, iguales). */
async function abortaSinTocar(mensaje: RegExp, etiqueta: string) {
  const antes = await foto();
  await expect(correr(RETIRO, "migration.sql"), etiqueta).rejects.toThrow(mensaje);
  expect(await foto(), `${etiqueta}: el retiro abortado no tocó nada`).toEqual(antes);
}

let sinGo3a: Foto;
let conGo3a: Foto;

beforeAll(async () => {
  base = await crearBaseTemporalMigrada();
  hayRol = (await base.cliente.query("SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app'")).rowCount === 1;
  if (!hayRol) return;
  await base.aplicarAntesDe(GO3_A);
  const c = base.cliente;
  // La base temporal no tiene los privilegios por defecto del rol de la app (son por base): se dan a mano sobre las tablas de antes, como en las otras pruebas de subir y bajar.
  await c.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO motor2_app`);
  // Como en una base real: `ProductoAdmiteGrupo` NO tiene UPDATE de tabla para la app, solo por columna (GO-1b). Sin esto, el UPDATE de tabla de arriba taparía el permiso por columna de
  // `ejeDeCombinacion` que agrega GO-3a (y que el retiro tiene que llevarse, y la reversa devolver).
  // (el REVOKE de tabla se lleva también los permisos por columna: se vuelven a dar los de GO-1b, tal cual su migración).
  await c.query(`REVOKE UPDATE ON "ProductoAdmiteGrupo" FROM motor2_app`);
  await c.query(`GRANT UPDATE ("orden", "cantidadMinima", "cantidadMaxima", "modoPrecio", "activo", "version", "actualizadoEn") ON "ProductoAdmiteGrupo" TO motor2_app`);
  await c.query(`INSERT INTO "Empresa" ("id","nombre","slug","zonaHoraria","moneda","estado") VALUES ($1,$1,$1,'America/Argentina/Buenos_Aires','ARS','ACTIVE')`, [E]);
  await c.query(`INSERT INTO "Sucursal" ("id","empresaId","nombre") VALUES ('suc_a',$1,'Centro'), ('suc_b',$1,'Norte')`, [E]);
  await c.query(`INSERT INTO "User" ("id","email") VALUES ('u_retiro','retiro@ejemplo.test')`);
  await c.query(`INSERT INTO "Rol" ("id","empresaId","nombre","clave") VALUES ('rol_admin_retiro',$1,'admin','admin'), ('rol_otro_retiro',$1,'encargado',NULL)`, [E]);
  await c.query(`INSERT INTO "Unidad" ("id","empresaId","nombre","magnitud") VALUES ('uni_retiro',$1,'u','CANTIDAD')`, [E]);
  await c.query(`INSERT INTO "Producto" ("id","empresaId","codigo","nombre","tipo","unidadStockId","precioVenta") VALUES ('mila_retiro',$1,'PV_MILA','Milanesa','PV','uni_retiro',8000)`, [E]);
  await c.query(`INSERT INTO "GrupoDeOpciones" ("id","empresaId","nombre","tipo","cantidadMinima","cantidadMaxima") VALUES ('gru_retiro',$1,'Tamaño','MEDIDA',1,1)`, [E]);
  await c.query(`INSERT INTO "OpcionDeGrupo" ("id","empresaId","grupoId","nombre") VALUES ('op_grande',$1,'gru_retiro','Grande'), ('op_chica',$1,'gru_retiro','Chica')`, [E]);
  await c.query(`INSERT INTO "ProductoAdmiteGrupo" ("id","empresaId","productoId","grupoId") VALUES ('pag_retiro',$1,'mila_retiro','gru_retiro')`, [E]);
  await c.query(`INSERT INTO "Mesa" ("id","empresaId","sucursalId","numero") VALUES ('mesa_a',$1,'suc_a',1), ('mesa_b',$1,'suc_b',1)`, [E]);
  await c.query(`INSERT INTO "Cuenta" ("id","empresaId","mesaId","abiertaPorId") VALUES ('cta_a',$1,'mesa_a','u_retiro'), ('cta_b',$1,'mesa_b','u_retiro')`, [E]);
  await c.query(`INSERT INTO "CuentaItem" ("id","empresaId","cuentaId","productoId","cantidad","precioUnitario") VALUES ('item_a',$1,'cta_a','mila_retiro',1,8000), ('item_b',$1,'cta_b','mila_retiro',1,8000)`, [E]);
  sinGo3a = await foto();
  await correr(GO3_A, "migration.sql");
  await correr(GO3_A_RLS, "migration.sql");
  conGo3a = await foto();
}, 300_000);

afterAll(async () => {
  await Promise.all(abiertas.map((c) => c.end().catch(() => undefined)));
  await base?.eliminar();
});

describe("retiro de GO-3a (Fase 3, paso 3.7): subir, bajar y subir", () => {
  it("0. las dos carpetas existen, van en orden después de GO-3a, avisan que requieren autorización y la de esquema ABORTA con datos", () => {
    if (!hayRol) return;
    expect(GO3_A_RLS < RETIRO_RLS && RETIRO_RLS < RETIRO).toBe(true);
    for (const m of [RETIRO_RLS, RETIRO]) expect(sql(m, "migration.sql").split("\n")[0], m).toContain("REQUIERE AUTORIZACIÓN EXPRESA");
    expect(sql(RETIRO, "migration.sql")).toMatch(/RAISE EXCEPTION 'No se puede retirar GO-3a/);
    // La reversa del esquema es el cuerpo de GO-3a, sin cambios.
    const cuerpo = sql(GO3_A, "migration.sql");
    expect(sql(RETIRO, "down.sql").endsWith(cuerpo.slice(cuerpo.indexOf('ALTER TABLE "ProductoAdmiteGrupo" ADD COLUMN IF NOT EXISTS "ejeDeCombinacion"')))).toBe(true);
    // Con GO-3a arriba, la foto de «con» tiene las seis tablas, la columna y la clave sembrada al admin.
    for (const t of TABLAS) expect(conGo3a.rls.some((r) => (r as { tabla: string }).tabla === t), t).toBe(true);
    expect(conGo3a.permisos).toContainEqual({ rolId: "rol_admin_retiro", accionClave: "grupos_de_precio_definir", puedeVer: true, puedeEditar: true });
  });

  it("1. SUBIR CON DATOS: el retiro ABORTA con cualquier fila, con un eje o con la clave configurada fuera de la semilla, sin tocar nada", async () => {
    if (!hayRol) return;
    const c = base.cliente;
    await correr(RETIRO_RLS, "migration.sql");
    await c.query(`INSERT INTO "GrupoDePrecio" ("id","empresaId","nombre","precio") VALUES ('gp',$1,'Mila grande',9000)`, [E]);
    await abortaSinTocar(/No se puede retirar GO-3a: hay 1 fila/, "con una tarifa");
    await c.query(`INSERT INTO "CombinacionDeProducto" ("id","empresaId","productoId","opcionEje1Id") VALUES ('cb',$1,'mila_retiro','op_chica')`, [E]);
    await c.query(`INSERT INTO "CombinacionEnLinea" ("id","empresaId","cuentaItemId","combinacionId","origenPrecio") VALUES ('foto',$1,'item_a','cb','ADITIVO')`, [E]);
    await abortaSinTocar(/No se puede retirar GO-3a: hay 3 fila/, "con una combinación y su foto");
    await c.query(`DELETE FROM "CombinacionEnLinea"`);
    await c.query(`INSERT INTO "PrecioLocalDeCombinacion" ("id","empresaId","sucursalId","combinacionId","precio") VALUES ('pl',$1,'suc_a','cb',9500)`, [E]);
    await c.query(`INSERT INTO "RecetaDeCombinacionVersion" ("id","empresaId","combinacionId","numero","creadoPorId") VALUES ('rv',$1,'cb',1,'u_retiro')`, [E]);
    await c.query(`INSERT INTO "RecetaDeCombinacionIngrediente" ("id","empresaId","versionId","insumoProductoId","cantidad","unidadId") VALUES ('ri',$1,'rv','mila_retiro',1,'uni_retiro')`, [E]);
    await abortaSinTocar(/No se puede retirar GO-3a: hay 5 fila/, "con precio local y receta propia");
    for (const t of ["RecetaDeCombinacionIngrediente", "RecetaDeCombinacionVersion", "PrecioLocalDeCombinacion", "CombinacionDeProducto", "GrupoDePrecio"]) await c.query(`DELETE FROM "${t}"`);
    await c.query(`UPDATE "ProductoAdmiteGrupo" SET "ejeDeCombinacion" = 1 WHERE "id" = 'pag_retiro'`);
    await abortaSinTocar(/No se puede retirar GO-3a: hay 1 fila/, "con un eje declarado");
    await c.query(`UPDATE "ProductoAdmiteGrupo" SET "ejeDeCombinacion" = NULL WHERE "id" = 'pag_retiro'`);
    await c.query(`UPDATE "PermisoRol" SET "puedeEditar" = false WHERE "accionClave" = 'grupos_de_precio_definir'`);
    await abortaSinTocar(/configuración de la clave grupos_de_precio_definir/, "con el admin sin Editar");
    await c.query(`UPDATE "PermisoRol" SET "puedeEditar" = true WHERE "accionClave" = 'grupos_de_precio_definir'`);
    await c.query(`INSERT INTO "PermisoRol" ("id","empresaId","rolId","accionClave","puedeVer","puedeEditar") VALUES ('pr_otro',$1,'rol_otro_retiro','grupos_de_precio_definir',true,false)`, [E]);
    await abortaSinTocar(/configuración de la clave grupos_de_precio_definir/, "con la clave delegada a otro rol");
    await c.query(`DELETE FROM "PermisoRol" WHERE "id" = 'pr_otro'`);
    await c.query(`INSERT INTO "CapacidadSucursal" ("id","empresaId","accionClave","sucursalId","habilitado") VALUES ('cap',$1,'grupos_de_precio_definir','suc_a',false)`, [E]);
    await abortaSinTocar(/configuración de la clave grupos_de_precio_definir/, "con una capacidad por sucursal");
    await c.query(`DELETE FROM "CapacidadSucursal" WHERE "id" = 'cap'`);
    // Sin nada que bloquee, se vuelve al estado de GO-3a arriba (la de políticas se baja para que el paso siguiente arranque de «con»).
    await correr(RETIRO_RLS, "down.sql");
    expect(await foto()).toEqual(conGo3a);
  });

  it("2. SUBIR: el catálogo queda IDÉNTICO al de antes de GO-3a (incluidas las claves de Accion y las filas de PermisoRol)", async () => {
    if (!hayRol) return;
    await correr(RETIRO_RLS, "migration.sql");
    await correr(RETIRO, "migration.sql");
    expect(await foto()).toEqual(sinGo3a);
  });

  it("3. humo como motor2_app: ProductoAdmiteGrupo se lee y se escribe; GrupoDePrecio ya no existe (42P01)", async () => {
    if (!hayRol) return;
    const app = await conectarComoApp();
    await app.query("BEGIN");
    try {
      await app.query("SELECT set_config('app.empresa_id', $1, true)", [E]);
      await app.query("SELECT set_config('app.sucursales_escritura', 'suc_a', true)");
      expect((await app.query(`SELECT "id" FROM "ProductoAdmiteGrupo"`)).rows).toEqual([{ id: "pag_retiro" }]);
      expect(await falla(app, `UPDATE "ProductoAdmiteGrupo" SET "orden" = 1 WHERE "id" = 'pag_retiro'`)).toBeNull();
      expect(await falla(app, `UPDATE "ProductoAdmiteGrupo" SET "empresaId" = 'otra' WHERE "id" = 'pag_retiro'`), "una columna sin permiso por columna").toBe("42501");
      expect(await falla(app, `SELECT 1 FROM "GrupoDePrecio"`)).toBe("42P01");
      expect(await falla(app, `SELECT 1 FROM "CombinacionEnLinea"`)).toBe("42P01");
      expect(await falla(app, `SELECT "ejeDeCombinacion" FROM "ProductoAdmiteGrupo"`)).toBe("42703");
    } finally {
      await app.query("ROLLBACK");
    }
  });

  it("4. BAJAR: el down.sql del esquema y después el de las políticas dejan el catálogo IDÉNTICO al de GO-3a aplicada (vacío, con la clave sembrada al admin)", async () => {
    if (!hayRol) return;
    await correr(RETIRO, "down.sql");
    await correr(RETIRO_RLS, "down.sql");
    expect(await foto()).toEqual(conGo3a);
    for (const t of TABLAS) expect(await q(`SELECT count(*)::int AS n FROM "${t}"`), t).toEqual([{ n: 0 }]);
  });

  it("5. SUBIR OTRA VEZ: idéntico al de antes de GO-3a", async () => {
    if (!hayRol) return;
    await correr(RETIRO_RLS, "migration.sql");
    await correr(RETIRO, "migration.sql");
    expect(await foto()).toEqual(sinGo3a);
  });
});
