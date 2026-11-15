import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";

/**
 * «Ocultar» como Pedernal, E3a (docs/diseno-ocultar-como-pedernal-2026-11-15.md, nivel 6): SUBIR, BAJAR y SUBIR la tabla `OcultamientoProducto` (y su migración de políticas de alcance) sobre una base
 * TEMPORAL migrada como una real y con datos de antes (dos empresas, sus sucursales y productos). Prueba:
 *  - SUBIR: la tabla, sus reglas, la RLS y los privilegios quedan, y no se toca ninguna fila de antes; un humo como `motor2_app` (el rol real, sujeto a la RLS) de las restricciones de la base: una marca de
 *    empresa y una por sucursal por producto, mismo dueño, sin DELETE, sin mover una fila de producto ni de alcance, aislamiento entre empresas y alcance de sucursal;
 *  - CONCURRENCIA e IDEMPOTENCIA en la base: dos altas simultáneas de la misma marca (`INSERT … ON CONFLICT`) dejan UNA fila; repetir la misma alta no duplica;
 *  - BAJAR CON DATOS: la reversa ABORTA sin dejar nada a medias; BAJAR SIN DATOS: el catálogo queda IDÉNTICO al de antes; bajar dos veces no falla; SUBIR OTRA VEZ: idéntico a la primera subida.
 * Contra Postgres local; nunca contra una base real.
 */
const RAIZ = join(__dirname, "../../prisma/migrations");
const TABLA = "20261115120000_ocultamiento_de_producto";
const RLS = "20261115121000_rls_sucursal_ocultamiento_de_producto";
const E = "empresa_ocu";
const OTRA = "empresa_ocu_otra";

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
    datos: await q(`SELECT (SELECT count(*) FROM "Producto") AS productos, (SELECT count(*) FROM "Sucursal") AS sucursales, (SELECT count(*) FROM "Empresa") AS empresas`),
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

const marca = (id: string, producto: string, sucursal: string | null, extra = "") =>
  `INSERT INTO "OcultamientoProducto" ("id","productoId","sucursalId","oculto","actualizadoPorId","actualizadoEn") VALUES ('${id}','${producto}',${sucursal === null ? "NULL" : `'${sucursal}'`},true,'u_ocu',now())${extra}`;

beforeAll(async () => {
  base = await crearBaseTemporalMigrada();
  hayRol = (await base.cliente.query("SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app'")).rowCount === 1;
  if (!hayRol) return;
  await base.aplicarAntesDe(TABLA);
  const c = base.cliente;
  // La base temporal no tiene los privilegios por defecto del rol de la app (son por base): se dan a mano sobre las tablas de antes, como en las otras pruebas de subir y bajar.
  await c.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO motor2_app`);
  for (const [empresa, sufijo] of [[E, "a"], [OTRA, "x"]] as const) {
    await c.query(`INSERT INTO "Empresa" ("id","nombre","slug","zonaHoraria","moneda","estado") VALUES ($1,$1,$1,'America/Argentina/Buenos_Aires','ARS','ACTIVE')`, [empresa]);
    await c.query(`INSERT INTO "Unidad" ("id","empresaId","nombre","magnitud") VALUES ('uni_${sufijo}',$1,'u','CANTIDAD')`, [empresa]);
    await c.query(`INSERT INTO "Producto" ("id","empresaId","codigo","nombre","tipo","unidadStockId","precioVenta") VALUES ('prod_${sufijo}1',$1,'PV_1','Milanesa','PV','uni_${sufijo}',8000), ('prod_${sufijo}2',$1,'PV_2','Flan','PV','uni_${sufijo}',3000)`, [empresa]);
  }
  await c.query(`INSERT INTO "Sucursal" ("id","empresaId","nombre") VALUES ('suc_a',$1,'Centro'), ('suc_b',$1,'Norte'), ('suc_x',$2,'Otra')`, [E, OTRA]);
  await c.query(`INSERT INTO "User" ("id","email") VALUES ('u_ocu','ocu@ejemplo.test')`);
}, 300_000);

afterAll(async () => {
  await Promise.all(abiertas.map((c) => c.end().catch(() => undefined)));
  await base?.eliminar();
});

describe("Ocultar E3a: subir, bajar y subir (OcultamientoProducto, con su migración de políticas)", () => {
  let antes: Foto;
  let arribaLaPrimeraVez: Foto;

  async function comprobarArriba(etiqueta: string) {
    const f = await foto();
    expect(f.rls.find((r) => r.tabla === "OcultamientoProducto"), `${etiqueta}: RLS`).toEqual({ tabla: "OcultamientoProducto", rls: true, forzado: false });
    expect(f.politicas.filter((p) => p.tabla === "OcultamientoProducto").map((p) => p.nombre), `${etiqueta}: 5 políticas`).toEqual([
      "aislamiento_empresa", "alcance_sucursal_delete", "alcance_sucursal_insert", "alcance_sucursal_select", "alcance_sucursal_update",
    ]);
    expect(f.privilegios.filter((p) => p.tabla === "OcultamientoProducto"), `${etiqueta}: la app lee y agrega; nada para plataforma, ni DELETE ni TRUNCATE`).toEqual([
      { tabla: "OcultamientoProducto", rol: "motor2_app", privilege_type: "INSERT" },
      { tabla: "OcultamientoProducto", rol: "motor2_app", privilege_type: "SELECT" },
    ]);
    expect(f.privilegiosDeColumna.filter((p) => p.tabla === "OcultamientoProducto" && p.privilege_type === "UPDATE").map((p) => p.columna), `${etiqueta}: solo cambia el estado`).toEqual([
      "actualizadoEn", "actualizadoPorId", "oculto", "version",
    ]);
    expect(f.datos, `${etiqueta}: no toca los datos de antes`).toEqual(antes.datos);
    expect(await q(`SELECT count(*)::int AS n FROM "OcultamientoProducto"`), `${etiqueta}: nace vacía (sin marca = visible)`).toEqual([{ n: 0 }]);
    // Humo como el rol real de la app: las restricciones las decide la base.
    await comoApp(E, { lectura: "suc_a", escritura: "suc_a" }, async (c) => {
      expect(await falla(c, marca("m_emp", "prod_a1", null)), `${etiqueta}: marca de empresa`).toBeNull();
      expect(await falla(c, marca("m_emp2", "prod_a1", null)), `${etiqueta}: dos marcas de empresa del mismo producto`).toBe("23505");
      expect(await falla(c, marca("m_emp", "prod_a2", null)), `${etiqueta}: mismo id`).toBe("23505");
      expect(await falla(c, marca("m_a", "prod_a1", "suc_a")), `${etiqueta}: marca de sucursal`).toBeNull();
      expect(await falla(c, marca("m_a2", "prod_a1", "suc_a")), `${etiqueta}: dos marcas del mismo producto en la sucursal`).toBe("23505");
      expect(await falla(c, marca("m_b", "prod_a1", "suc_b")), `${etiqueta}: sucursal fuera del alcance`).toBe("42501");
      expect(await falla(c, marca("m_x", "prod_x1", null)), `${etiqueta}: producto de otra empresa`).toBe("23503");
      expect(await falla(c, marca("m_sx", "prod_a2", "suc_x")), `${etiqueta}: sucursal de otra empresa, fuera del alcance`).toBe("42501");
      expect(await falla(c, `INSERT INTO "OcultamientoProducto" ("id","productoId","sucursalId","oculto","actualizadoPorId","actualizadoEn","version") VALUES ('m_v','prod_a2',NULL,true,'u_ocu',now(),0)`), `${etiqueta}: versión 0`).toBe("23514");
      expect(await falla(c, `INSERT INTO "OcultamientoProducto" ("id","productoId","sucursalId","oculto","actualizadoPorId","actualizadoEn") VALUES (' ','prod_a2',NULL,true,'u_ocu',now())`), `${etiqueta}: id vacío`).toBe("23514");
      expect(await falla(c, `INSERT INTO "OcultamientoProducto" ("id","productoId","oculto","actualizadoPorId","actualizadoEn") VALUES ('m_nu','prod_a2',true,'no_existe',now())`), `${etiqueta}: quién cambió tiene que existir`).toBe("23503");
      expect(await falla(c, `UPDATE "OcultamientoProducto" SET "oculto" = false, "version" = "version" + 1, "actualizadoEn" = now(), "actualizadoPorId" = 'u_ocu' WHERE "id" = 'm_a'`), `${etiqueta}: volver a mostrar`).toBeNull();
      expect(await falla(c, `UPDATE "OcultamientoProducto" SET "productoId" = 'prod_a2' WHERE "id" = 'm_a'`), `${etiqueta}: mover la fila de producto`).toBe("42501");
      expect(await falla(c, `UPDATE "OcultamientoProducto" SET "sucursalId" = 'suc_b' WHERE "id" = 'm_a'`), `${etiqueta}: mover la fila de sucursal`).toBe("42501");
      expect(await falla(c, `DELETE FROM "OcultamientoProducto"`), `${etiqueta}: DELETE`).toBe("42501");
      expect(await falla(c, `TRUNCATE "OcultamientoProducto"`), `${etiqueta}: TRUNCATE`).toBe("42501");
      expect((await c.query(`SELECT "id" FROM "OcultamientoProducto" ORDER BY 1`)).rows, `${etiqueta}: ve la de empresa y la de su sucursal`).toEqual([{ id: "m_a" }, { id: "m_emp" }]);
    });
    await comoApp(E, { escritura: "suc_a,suc_x" }, async (c) => {
      expect(await falla(c, marca("m_sx", "prod_a2", "suc_x")), `${etiqueta}: aun con el alcance abierto, la sucursal de otra empresa la frena la clave foránea`).toBe("23503");
    });
    await comoApp(E, {}, async (c) => {
      expect(await falla(c, marca("m_sin", "prod_a2", null)), `${etiqueta}: sin alcance no se escribe ni la de empresa`).toBe("42501");
    });
    return f;
  }

  it("0. las dos migraciones existen, van en orden, avisan que requieren autorización y la de esquema ABORTA con datos", () => {
    if (!hayRol) return;
    expect(TABLA < RLS && TABLA > "20261112170000_nombre_unico_sin_mayusculas").toBe(true);
    for (const m of [TABLA, RLS]) expect(sql(m, "migration.sql").split("\n")[0], m).toContain("REQUIERE AUTORIZACIÓN EXPRESA");
    expect(sql(TABLA, "down.sql")).toMatch(/ABORTA/);
    expect(sql(TABLA, "migration.sql")).not.toMatch(/DROP |DELETE FROM|UPDATE "(?!OcultamientoProducto)|ALTER TABLE "(?!OcultamientoProducto)/);
  });

  it("1. SUBIR: sobre una base con datos de antes, deja todo arriba sin tocar lo que había, y anda como motor2_app", async () => {
    if (!hayRol) return;
    antes = await foto();
    expect(antes.rls.find((r) => r.tabla === "OcultamientoProducto"), "antes no existe la tabla").toBeUndefined();
    await correr(TABLA, "migration.sql");
    await correr(RLS, "migration.sql");
    arribaLaPrimeraVez = await comprobarArriba("primera subida");
  });

  it("2. CONCURRENCIA e IDEMPOTENCIA: dos altas simultáneas de la misma marca dejan UNA fila; repetirla no duplica", async () => {
    if (!hayRol) return;
    const alta = (id: string) => `${marca(id, "prod_a2", null)} ON CONFLICT ("empresaId","productoId") WHERE "sucursalId" IS NULL DO NOTHING RETURNING "id"`;
    const [a, b] = [await conectarComoApp(), await conectarComoApp()];
    for (const c of [a, b]) {
      await c.query("BEGIN");
      await fijar(c, E, { escritura: "suc_a" });
    }
    expect((await a.query(alta("conc_a"))).rowCount, "la primera alta entra").toBe(1);
    const segunda = b.query(alta("conc_b")); // queda esperando el índice único de la primera
    await new Promise((r) => setTimeout(r, 300));
    await a.query("COMMIT");
    expect((await segunda).rowCount, "la segunda, simultánea, no agrega nada").toBe(0);
    await b.query("COMMIT");
    await a.query("BEGIN");
    await fijar(a, E, { escritura: "suc_a" });
    expect((await a.query(alta("conc_c"))).rowCount, "repetir la misma alta tampoco").toBe(0);
    await a.query("COMMIT");
    expect(await q(`SELECT "id" FROM "OcultamientoProducto" WHERE "productoId" = 'prod_a2'`), "una sola fila").toEqual([{ id: "conc_a" }]);
    await base.cliente.query(`DELETE FROM "OcultamientoProducto"`);
  });

  it("3. BAJAR CON DATOS: la reversa de esquema ABORTA sin dejar nada a medias; la de políticas pasa (no es destructiva)", async () => {
    if (!hayRol) return;
    await base.cliente.query(`INSERT INTO "OcultamientoProducto" ("id","empresaId","productoId","oculto","actualizadoPorId","actualizadoEn") VALUES ('dato',$1,'prod_a1',true,'u_ocu',now())`, [E]);
    await correr(RLS, "down.sql");
    expect((await foto()).politicas.filter((p) => p.tabla === "OcultamientoProducto").map((p) => p.nombre), "sin la migración de políticas queda solo la de empresa").toEqual(["aislamiento_empresa"]);
    const conDatos = await foto();
    await expect(correr(TABLA, "down.sql")).rejects.toThrow(/No se puede bajar 20261115120000_ocultamiento_de_producto: hay 1 marca/);
    expect(await foto(), "la reversa abortada no tocó nada").toEqual(conDatos);
    await base.cliente.query(`DELETE FROM "OcultamientoProducto"`);
  });

  it("4. BAJAR SIN DATOS: el catálogo queda IDÉNTICO al de antes; las reversas son idempotentes", async () => {
    if (!hayRol) return;
    await correr(TABLA, "down.sql");
    expect(await foto()).toEqual(antes);
    await correr(TABLA, "down.sql");
    expect(await foto(), "bajar dos veces no cambia nada").toEqual(antes);
  });

  it("5. SUBIR OTRA VEZ: el catálogo es idéntico al de la primera subida y todo anda", async () => {
    if (!hayRol) return;
    await correr(TABLA, "migration.sql");
    await correr(RLS, "migration.sql");
    expect(await comprobarArriba("segunda subida")).toEqual(arribaLaPrimeraVez);
  });
});
