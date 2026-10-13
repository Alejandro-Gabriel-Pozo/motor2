import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";
import { clavesReservadasDe } from "../setup/claves-reservadas-en-base";

/**
 * GO-3 (ADR-032): SUBIR, BAJAR y SUBIR las migraciones de GO-3 sobre una base TEMPORAL que se fue migrando como una real (todas las migraciones anteriores aplicadas, con datos de antes: una empresa
 * con dos sucursales, su admin y otro rol, un producto y una promo con un cupo de sección). Por cada paquete:
 *  - SUBIR: las tablas, las columnas, las reglas, las políticas, los privilegios y la clave del admin quedan; lo que había (el cupo de sección) queda como estaba (SECCION, activo, sin nombre);
 *    un humo como `motor2_app` con la RLS real (el plato del día de otra sucursal no se ve ni se escribe);
 *  - BAJAR CON DATOS: la reversa ABORTA por cada motivo (filas nuevas, cupos de tipo nuevo o dados de baja, vigencia, configuración de la clave tocada) SIN dejar nada a medias (el catálogo de la base no cambia);
 *  - BAJAR SIN DATOS: de la migración de políticas a la de esquema, el catálogo queda IDÉNTICO al de antes de GO-3 (columnas, índices, restricciones, políticas, privilegios, funciones);
 *  - SUBIR OTRA VEZ: el catálogo es idéntico al de la primera subida; y las reversas son idempotentes (bajar dos veces no falla).
 * Es la prueba de que las migraciones son aditivas (no reescriben datos) y reversibles sin pérdida silenciosa. Contra Postgres local; nunca contra una base real.
 */
const RAIZ = join(__dirname, "../../prisma/migrations");
const GO3_D = "20261021100000_go3d_combos_y_menu_del_dia";
const GO3_D_RLS = "20261021101000_go3d_rls_sucursal_menu_del_dia";
const GO3_A = "20261021110000_go3a_combinaciones";
const GO3_A_RLS = "20261021111000_go3a_rls_sucursal_combinaciones";
const E = "empresa_go3";

const sql = (migracion: string, archivo: "migration.sql" | "down.sql") => readFileSync(join(RAIZ, migracion, archivo), "utf8");
let base: BaseTemporalMigrada;
let hayRol = false;
const abiertas: Client[] = [];

const correr = (migracion: string, archivo: "migration.sql" | "down.sql") => base.cliente.query(sql(migracion, archivo));
const q = <T extends object = Record<string, unknown>>(texto: string, params: unknown[] = []) => base.cliente.query<T>(texto, params).then((r) => r.rows);
const cuantos = async (tabla: string, filtro = "TRUE") => Number((await q<{ n: string }>(`SELECT count(*) AS n FROM "${tabla}" WHERE ${filtro}`))[0]!.n);

/** Una foto del catálogo de `public`: lo que una migración puede tocar. */
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

/** Corre `fn` como `motor2_app` dentro de una transacción que se deshace, con la empresa y el alcance fijados. */
async function comoApp(alcance: { lectura?: string; escritura?: string }, fn: (c: Client) => Promise<void>) {
  const app = await conectarComoApp();
  await app.query("BEGIN");
  try {
    await app.query("SELECT set_config('app.empresa_id', $1, true)", [E]);
    if (alcance.lectura !== undefined) await app.query("SELECT set_config('app.sucursales_lectura', $1, true)", [alcance.lectura]);
    if (alcance.escritura !== undefined) await app.query("SELECT set_config('app.sucursales_escritura', $1, true)", [alcance.escritura]);
    await fn(app);
  } finally {
    await app.query("ROLLBACK");
  }
}

/** Que una reversa ABORTÓ con su mensaje y no dejó nada a medias (el catálogo y los datos de antes, iguales). */
async function abortaSinTocar(migracion: string, mensaje: RegExp, etiqueta: string) {
  const antes = await foto();
  await expect(correr(migracion, "down.sql"), etiqueta).rejects.toThrow(mensaje);
  expect(await foto(), `${etiqueta}: la reversa abortada no tocó nada`).toEqual(antes);
}

beforeAll(async () => {
  base = await crearBaseTemporalMigrada();
  hayRol = (await base.cliente.query("SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app'")).rowCount === 1;
  if (!hayRol) return;
  await base.aplicarAntesDe(GO3_D);
  // GO-3d y GO-3a se suben y se bajan a mano en este archivo: la base temporal NO las aplica nunca sola (así cada bloque parte del estado de antes de su paquete).
  const c = base.cliente;
  // La base temporal no tiene los privilegios por defecto del rol de la app (son por base): se dan a mano sobre las tablas de antes, como en las otras pruebas de subir y bajar.
  await c.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO motor2_app`);
  await c.query(`INSERT INTO "Empresa" ("id","nombre","slug","zonaHoraria","moneda","estado") VALUES ($1,$1,$1,'America/Argentina/Buenos_Aires','ARS','ACTIVE')`, [E]);
  await c.query(`INSERT INTO "Sucursal" ("id","empresaId","nombre") VALUES ('suc_a',$1,'Centro'), ('suc_b',$1,'Norte')`, [E]);
  await c.query(`INSERT INTO "User" ("id","email") VALUES ('u_go3','go3@ejemplo.test')`);
  await c.query(`INSERT INTO "Rol" ("id","empresaId","nombre","clave") VALUES ('rol_admin_go3',$1,'admin','admin'), ('rol_otro_go3',$1,'encargado',NULL)`, [E]);
  await c.query(`INSERT INTO "Unidad" ("id","empresaId","nombre","magnitud") VALUES ('uni_go3',$1,'u','CANTIDAD')`, [E]);
  await c.query(`INSERT INTO "Producto" ("id","empresaId","codigo","nombre","tipo","unidadStockId","precioVenta") VALUES ('mila_go3',$1,'PV_MILA','Milanesa','PV','uni_go3',8000)`, [E]);
  await c.query(`INSERT INTO "SeccionCarta" ("id","empresaId","nombre") VALUES ('sec_go3',$1,'Menú')`, [E]);
  await c.query(`INSERT INTO "PromoCarta" ("id","empresaId","seccionCartaId","titulo","precio") VALUES ('promo_go3',$1,'sec_go3','Menú del día',9500)`, [E]);
  await c.query(`INSERT INTO "PromoCartaCupo" ("id","empresaId","promoCartaId","seccionCartaId","cantidadMinima","cantidadMaxima") VALUES ('cupo_sec_go3',$1,'promo_go3','sec_go3',1,1)`, [E]);
  // Para GO-3a: un grupo MEDIDA con una opción que la milanesa admite (todavía sin eje), y una línea de una mesa en cada sucursal.
  await c.query(`INSERT INTO "GrupoDeOpciones" ("id","empresaId","nombre","tipo","cantidadMinima","cantidadMaxima") VALUES ('gru_go3',$1,'Tamaño','MEDIDA',1,1)`, [E]);
  await c.query(`INSERT INTO "OpcionDeGrupo" ("id","empresaId","grupoId","nombre") VALUES ('op_grande',$1,'gru_go3','Grande'), ('op_chica',$1,'gru_go3','Chica')`, [E]);
  await c.query(`INSERT INTO "ProductoAdmiteGrupo" ("id","empresaId","productoId","grupoId") VALUES ('pag_go3',$1,'mila_go3','gru_go3')`, [E]);
  await c.query(`INSERT INTO "Mesa" ("id","empresaId","sucursalId","numero") VALUES ('mesa_a',$1,'suc_a',1), ('mesa_b',$1,'suc_b',1)`, [E]);
  await c.query(`INSERT INTO "Cuenta" ("id","empresaId","mesaId","abiertaPorId") VALUES ('cta_a',$1,'mesa_a','u_go3'), ('cta_b',$1,'mesa_b','u_go3')`, [E]);
  await c.query(`INSERT INTO "CuentaItem" ("id","empresaId","cuentaId","productoId","cantidad","precioUnitario") VALUES ('item_a',$1,'cta_a','mila_go3',1,8000), ('item_b',$1,'cta_b','mila_go3',1,8000)`, [E]);
}, 300_000);

afterAll(async () => {
  await Promise.all(abiertas.map((c) => c.end().catch(() => undefined)));
  await base?.eliminar();
});

describe("GO-3d: subir, bajar y subir (combos y menú del día, con su migración de políticas)", () => {
  let antesDeGo3d: Foto;
  let arribaLaPrimeraVez: Foto;
  const TABLAS = ["EntradaDeCupo", "OpcionDeEntradaDeCupo", "EntradaDelDiaDeCupo"];

  async function comprobarArriba(etiqueta: string) {
    const f = await foto();
    for (const t of TABLAS) expect(f.rls.find((r) => r.tabla === t), `${etiqueta}: ${t} con RLS`).toEqual({ tabla: t, rls: true, forzado: false });
    expect(f.politicas.filter((p) => p.tabla === "EntradaDelDiaDeCupo").map((p) => p.nombre), `${etiqueta}: el plato del día con sus 5 políticas`).toEqual([
      "aislamiento_empresa", "alcance_sucursal_delete", "alcance_sucursal_insert", "alcance_sucursal_select", "alcance_sucursal_update",
    ]);
    expect(await q(`SELECT "version" FROM "PromoCarta" WHERE "id" = 'promo_go3'`), `${etiqueta}: la promo de antes queda en la versión 1`).toEqual([{ version: 1 }]);
    expect(await q(`SELECT "tipo", "nombre", "activo", "seccionCartaId" FROM "PromoCartaCupo" WHERE "id" = 'cupo_sec_go3'`), `${etiqueta}: el cupo de antes quedó como estaba`).toEqual([
      { tipo: "SECCION", nombre: null, activo: true, seccionCartaId: "sec_go3" },
    ]);
    expect(clavesReservadasDe(GO3_D), "la clave de GO-3d").toEqual(["promo_menu_del_dia"]);
    expect(await q(`SELECT "rolId", "puedeVer", "puedeEditar" FROM "PermisoRol" WHERE "accionClave" = 'promo_menu_del_dia'`), `${etiqueta}: solo el admin, con Ver y Editar`).toEqual([
      { rolId: "rol_admin_go3", puedeVer: true, puedeEditar: true },
    ]);
    // Humo como el rol real de la app.
    await comoApp({ lectura: "suc_a", escritura: "suc_a" }, async (c) => {
      expect(await falla(c, `INSERT INTO "PromoCartaCupo" ("id","promoCartaId","tipo","nombre","cantidadMinima","cantidadMaxima") VALUES ('cupo_del_dia','promo_go3','DEL_DIA','Plato del día',1,1)`), `${etiqueta}: cupo DEL_DIA`).toBeNull();
      expect(await falla(c, `INSERT INTO "EntradaDelDiaDeCupo" ("id","cupoId","sucursalId","fecha","productoId","actualizadoPorId") VALUES ('p_a','cupo_del_dia','suc_a','2026-10-14','mila_go3','u_go3')`), `${etiqueta}: plato del día en A`).toBeNull();
      expect(await falla(c, `INSERT INTO "EntradaDelDiaDeCupo" ("id","cupoId","sucursalId","fecha","productoId","actualizadoPorId") VALUES ('p_b','cupo_del_dia','suc_b','2026-10-14','mila_go3','u_go3')`), `${etiqueta}: plato del día en B desde A`).toBe("42501");
      expect(await falla(c, `DELETE FROM "EntradaDelDiaDeCupo"`), `${etiqueta}: DELETE`).toBe("42501");
      expect(await falla(c, `INSERT INTO "EntradaDeCupo" ("id","cupoId","productoId") VALUES ('ent','cupo_del_dia','mila_go3')`), `${etiqueta}: entrada de empresa`).toBeNull();
    });
    return f;
  }

  it("0. las dos migraciones existen, van en orden después de GO-1, avisan que requieren autorización y tienen down.sql (la de esquema ABORTA con datos)", () => {
    if (!hayRol) return;
    expect(GO3_D < GO3_D_RLS && GO3_D > "20261020131000_go1d_rls_sucursal_opcion_elegida").toBe(true);
    for (const m of [GO3_D, GO3_D_RLS]) expect(sql(m, "migration.sql").split("\n")[0], m).toContain("REQUIERE AUTORIZACIÓN EXPRESA");
    expect(sql(GO3_D, "down.sql")).toMatch(/ABORTA/);
  });

  it("1. SUBIR: sobre una base con datos de antes, deja todo arriba sin tocar lo que había, y anda como motor2_app", async () => {
    if (!hayRol) return;
    antesDeGo3d = await foto();
    for (const t of TABLAS) expect(antesDeGo3d.rls.find((r) => r.tabla === t), `antes de GO-3d no existe ${t}`).toBeUndefined();
    await correr(GO3_D, "migration.sql");
    await correr(GO3_D_RLS, "migration.sql");
    arribaLaPrimeraVez = await comprobarArriba("primera subida");
  });

  it("2. BAJAR CON DATOS: la reversa de esquema ABORTA por cada motivo sin dejar nada a medias; la de políticas pasa (no es destructiva)", async () => {
    if (!hayRol) return;
    const c = base.cliente;
    await c.query(`INSERT INTO "PromoCartaCupo" ("id","empresaId","promoCartaId","tipo","nombre","cantidadMinima","cantidadMaxima") VALUES ('cupo_lista',$1,'promo_go3','LISTA','Entrada',1,1)`, [E]);
    await c.query(`INSERT INTO "EntradaDeCupo" ("id","empresaId","cupoId","productoId") VALUES ('ent_1',$1,'cupo_lista','mila_go3')`, [E]);
    await c.query(`INSERT INTO "EntradaDelDiaDeCupo" ("id","empresaId","cupoId","sucursalId","fecha","productoId","actualizadoPorId") VALUES ('dia_1',$1,'cupo_lista','suc_a','2026-10-14','mila_go3','u_go3')`, [E]);
    await correr(GO3_D_RLS, "down.sql");
    expect((await foto()).politicas.filter((p) => p.tabla === "EntradaDelDiaDeCupo").map((p) => p.nombre), "sin GO-3d-rls queda solo la de empresa").toEqual(["aislamiento_empresa"]);
    expect(await cuantos("EntradaDelDiaDeCupo"), "la reversa de políticas no toca datos").toBe(1);
    await abortaSinTocar(GO3_D, /No se puede bajar GO-3d: hay 3 fila/, "con una entrada, un plato del día y un cupo LISTA");
    await c.query(`DELETE FROM "EntradaDelDiaDeCupo"`);
    await c.query(`DELETE FROM "EntradaDeCupo"`);
    await abortaSinTocar(GO3_D, /No se puede bajar GO-3d: hay 1 fila/, "con un cupo LISTA");
    await c.query(`DELETE FROM "PromoCartaCupo" WHERE "id" = 'cupo_lista'`);
    await c.query(`UPDATE "PromoCartaCupo" SET "activo" = false WHERE "id" = 'cupo_sec_go3'`);
    await abortaSinTocar(GO3_D, /No se puede bajar GO-3d: hay 1 fila/, "con un cupo de sección dado de baja");
    await c.query(`UPDATE "PromoCartaCupo" SET "activo" = true WHERE "id" = 'cupo_sec_go3'`);
    await c.query(`UPDATE "PromoCarta" SET "diasDeSemana" = 31 WHERE "id" = 'promo_go3'`);
    await abortaSinTocar(GO3_D, /No se puede bajar GO-3d: hay 1 fila/, "con una promo con días de semana");
    await c.query(`UPDATE "PromoCarta" SET "diasDeSemana" = NULL WHERE "id" = 'promo_go3'`);
    await c.query(`UPDATE "PromoCarta" SET "version" = 2 WHERE "id" = 'promo_go3'`);
    await abortaSinTocar(GO3_D, /No se puede bajar GO-3d: hay 1 fila/, "con una promo ya editada con el control optimista");
    await c.query(`UPDATE "PromoCarta" SET "version" = 1 WHERE "id" = 'promo_go3'`);
    await c.query(`INSERT INTO "PermisoRol" ("id","empresaId","rolId","accionClave","puedeVer","puedeEditar") VALUES ('delegada',$1,'rol_otro_go3','promo_menu_del_dia',true,true)`, [E]);
    await abortaSinTocar(GO3_D, /configuración de la clave promo_menu_del_dia/, "con la clave delegada al encargado");
    await c.query(`DELETE FROM "PermisoRol" WHERE "id" = 'delegada'`);
  });

  it("3. BAJAR SIN DATOS: el catálogo (y las claves) quedan IDÉNTICOS a los de antes de GO-3d; las reversas son idempotentes", async () => {
    if (!hayRol) return;
    await correr(GO3_D, "down.sql");
    expect(await foto()).toEqual(antesDeGo3d);
    await correr(GO3_D_RLS, "down.sql");
    await correr(GO3_D, "down.sql");
    expect(await foto(), "bajar dos veces no cambia nada").toEqual(antesDeGo3d);
  });

  it("4. SUBIR OTRA VEZ: el catálogo es idéntico al de la primera subida y todo anda", async () => {
    if (!hayRol) return;
    await correr(GO3_D, "migration.sql");
    await correr(GO3_D_RLS, "migration.sql");
    const otraVez = await comprobarArriba("segunda subida");
    expect(otraVez).toEqual(arribaLaPrimeraVez);
  });
});

describe("GO-3a: subir, bajar y subir (combinaciones, con su migración de políticas), con GO-3d arriba", () => {
  let antesDeGo3a: Foto;
  let arribaLaPrimeraVez: Foto;
  const TABLAS = ["GrupoDePrecio", "CombinacionDeProducto", "PrecioLocalDeCombinacion", "RecetaDeCombinacionVersion", "RecetaDeCombinacionIngrediente", "CombinacionEnLinea"];

  async function comprobarArriba(etiqueta: string) {
    const f = await foto();
    for (const t of TABLAS) expect(f.rls.find((r) => r.tabla === t), `${etiqueta}: ${t} con RLS`).toEqual({ tabla: t, rls: true, forzado: false });
    for (const t of ["PrecioLocalDeCombinacion", "CombinacionEnLinea"]) expect(f.politicas.filter((p) => p.tabla === t).length, `${etiqueta}: ${t} con 5 políticas`).toBe(5);
    expect(await q(`SELECT "ejeDeCombinacion" FROM "ProductoAdmiteGrupo" WHERE "id" = 'pag_go3'`), `${etiqueta}: el grupo admitido de antes quedó sin eje`).toEqual([{ ejeDeCombinacion: null }]);
    expect(clavesReservadasDe(GO3_A), "la clave de GO-3a").toEqual(["grupos_de_precio_definir"]);
    expect(await q(`SELECT "rolId" FROM "PermisoRol" WHERE "accionClave" = 'grupos_de_precio_definir'`), `${etiqueta}: solo el admin`).toEqual([{ rolId: "rol_admin_go3" }]);
    await comoApp({ lectura: "suc_a", escritura: "suc_a" }, async (c) => {
      expect(await falla(c, `UPDATE "ProductoAdmiteGrupo" SET "ejeDeCombinacion" = 1 WHERE "id" = 'pag_go3'`), `${etiqueta}: declarar el eje`).toBeNull();
      expect(await falla(c, `INSERT INTO "GrupoDePrecio" ("id","nombre","precio") VALUES ('gp','Mila grande',9000)`), `${etiqueta}: grupo de precio`).toBeNull();
      expect(await falla(c, `INSERT INTO "CombinacionDeProducto" ("id","productoId","opcionEje1Id","grupoDePrecioId") VALUES ('cb','mila_go3','op_grande','gp')`), `${etiqueta}: combinación`).toBeNull();
      expect(await falla(c, `INSERT INTO "CombinacionDeProducto" ("id","productoId","opcionEje1Id") VALUES ('cb2','mila_go3','op_grande')`), `${etiqueta}: repetida`).toBe("23505");
      expect(await falla(c, `INSERT INTO "PrecioLocalDeCombinacion" ("id","sucursalId","grupoDePrecioId","precio") VALUES ('pl_a','suc_a','gp',9500)`), `${etiqueta}: precio local en A`).toBeNull();
      expect(await falla(c, `INSERT INTO "PrecioLocalDeCombinacion" ("id","sucursalId","grupoDePrecioId","precio") VALUES ('pl_b','suc_b','gp',9500)`), `${etiqueta}: precio local en B desde A`).toBe("42501");
      expect(await falla(c, `INSERT INTO "CombinacionEnLinea" ("id","cuentaItemId","combinacionId","origenPrecio","grupoDePrecioId","nombreGrupoDePrecio","precio") VALUES ('fa','item_a','cb','GRUPO','gp','Mila grande',9000)`), `${etiqueta}: foto en A`).toBeNull();
      expect(await falla(c, `INSERT INTO "CombinacionEnLinea" ("id","cuentaItemId","combinacionId","origenPrecio") VALUES ('fb','item_b','cb','ADITIVO')`), `${etiqueta}: foto en B desde A`).toBe("42501");
      expect(await falla(c, `DELETE FROM "CombinacionEnLinea"`), `${etiqueta}: DELETE de la foto`).toBe("42501");
    });
    return f;
  }

  it("0. las dos migraciones existen, van en orden después de GO-3d, avisan que requieren autorización y la de esquema ABORTA con datos", () => {
    if (!hayRol) return;
    expect(GO3_D_RLS < GO3_A && GO3_A < GO3_A_RLS).toBe(true);
    for (const m of [GO3_A, GO3_A_RLS]) expect(sql(m, "migration.sql").split("\n")[0], m).toContain("REQUIERE AUTORIZACIÓN EXPRESA");
    expect(sql(GO3_A, "down.sql")).toMatch(/ABORTA/);
  });

  it("1. SUBIR: sobre la base con GO-3d arriba y datos de antes, deja todo arriba y anda como motor2_app", async () => {
    if (!hayRol) return;
    antesDeGo3a = await foto();
    await correr(GO3_A, "migration.sql");
    await correr(GO3_A_RLS, "migration.sql");
    arribaLaPrimeraVez = await comprobarArriba("primera subida");
  });

  it("2. BAJAR CON DATOS: la reversa de esquema ABORTA con cualquier fila nueva, con un eje declarado o con la clave delegada, sin dejar nada a medias", async () => {
    if (!hayRol) return;
    const c = base.cliente;
    await correr(GO3_A_RLS, "down.sql");
    await c.query(`INSERT INTO "GrupoDePrecio" ("id","empresaId","nombre","precio") VALUES ('gp',$1,'Mila grande',9000)`, [E]);
    await abortaSinTocar(GO3_A, /No se puede bajar GO-3a: hay 1 fila/, "con un grupo de precio");
    await c.query(`INSERT INTO "CombinacionDeProducto" ("id","empresaId","productoId","opcionEje1Id") VALUES ('cb',$1,'mila_go3','op_chica')`, [E]);
    await c.query(`INSERT INTO "CombinacionEnLinea" ("id","empresaId","cuentaItemId","combinacionId","origenPrecio") VALUES ('foto',$1,'item_a','cb','ADITIVO')`, [E]);
    await abortaSinTocar(GO3_A, /No se puede bajar GO-3a: hay 3 fila/, "con una combinación y su foto");
    await c.query(`DELETE FROM "CombinacionEnLinea"`);
    await c.query(`DELETE FROM "CombinacionDeProducto"`);
    await c.query(`DELETE FROM "GrupoDePrecio"`);
    await c.query(`UPDATE "ProductoAdmiteGrupo" SET "ejeDeCombinacion" = 1 WHERE "id" = 'pag_go3'`);
    await abortaSinTocar(GO3_A, /No se puede bajar GO-3a: hay 1 fila/, "con un eje declarado");
    await c.query(`UPDATE "ProductoAdmiteGrupo" SET "ejeDeCombinacion" = NULL WHERE "id" = 'pag_go3'`);
    await c.query(`UPDATE "PermisoRol" SET "puedeEditar" = false WHERE "accionClave" = 'grupos_de_precio_definir'`);
    await abortaSinTocar(GO3_A, /configuración de la clave grupos_de_precio_definir/, "con el admin sin Editar");
    await c.query(`UPDATE "PermisoRol" SET "puedeEditar" = true WHERE "accionClave" = 'grupos_de_precio_definir'`);
  });

  it("3. BAJAR SIN DATOS: el catálogo queda IDÉNTICO al de antes de GO-3a (GO-3d intacta); las reversas son idempotentes", async () => {
    if (!hayRol) return;
    await correr(GO3_A, "down.sql");
    expect(await foto()).toEqual(antesDeGo3a);
    await correr(GO3_A_RLS, "down.sql");
    await correr(GO3_A, "down.sql");
    expect(await foto()).toEqual(antesDeGo3a);
  });

  it("4. SUBIR OTRA VEZ: el catálogo es idéntico al de la primera subida y todo anda", async () => {
    if (!hayRol) return;
    await correr(GO3_A, "migration.sql");
    await correr(GO3_A_RLS, "migration.sql");
    expect(await comprobarArriba("segunda subida")).toEqual(arribaLaPrimeraVez);
  });

  it("5. EL CICLO COMPLETO DE GO-3: se baja todo (GO-3a-rls, GO-3a, GO-3d-rls, GO-3d) hasta el estado de antes de GO-3 y se vuelve a subir", async () => {
    if (!hayRol) return;
    const arriba = await foto();
    for (const [m, a] of [[GO3_A_RLS, "down.sql"], [GO3_A, "down.sql"], [GO3_D_RLS, "down.sql"], [GO3_D, "down.sql"]] as const) await correr(m, a);
    expect(await q(`SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('EntradaDeCupo', 'GrupoDePrecio')`), "sin tablas de GO-3").toEqual([]);
    expect(await q(`SELECT is_nullable FROM information_schema.columns WHERE table_name = 'PromoCartaCupo' AND column_name = 'seccionCartaId'`)).toEqual([{ is_nullable: "NO" }]);
    for (const m of [GO3_D, GO3_D_RLS, GO3_A, GO3_A_RLS]) await correr(m, "migration.sql");
    expect(await foto()).toEqual(arriba);
  });
});
