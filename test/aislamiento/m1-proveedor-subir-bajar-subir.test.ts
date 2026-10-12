import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";

/**
 * M1 (Paquete 2, C20): SUBIR, BAJAR y SUBIR de la migración real 20261015110000_proveedor_ofrece_productos_y_servicios sobre una base TEMPORAL descartable
 * (`crearBaseTemporalMigrada`: solo Postgres local, jamás `motor2_dev`, `motor2_e2e` ni una base real), con su `down.sql` tal cual está en el repo.
 *
 * La reversa de M1 borra las dos columnas: es DESTRUCTIVA para la clasificación una vez que alguien la edita (ver el encabezado de `down.sql`). Acá corre sobre la base
 * temporal, que se borra al terminar.
 *
 * Qué comprueba:
 *  1. ANTES de M1 hay un proveedor real (sembrado con SQL crudo); se saca una foto del catálogo de "Proveedor" (columnas, restricciones, índices, políticas y privilegios).
 *  2. SUBIR (solo el `migration.sql` de M1): el proveedor previo queda como «productos» (true, false) sin otro cambio, y aparece el CHECK, validado.
 *  3. BAJAR: el catálogo de "Proveedor" queda IDÉNTICO al de antes de M1 y el proveedor previo sigue con sus datos. La primera sentencia de la reversa ya saca el CHECK.
 *  4. SUBIR OTRA VEZ: el catálogo es idéntico al de la primera subida, y el proveedor sigue.
 *  5. Idempotencia: bajar dos veces y subir dos veces seguidas no falla ni cambia nada.
 *
 * Mutación: comentar el `DROP COLUMN "ofreceServicios"` de `down.sql` deja en rojo el paso 3; comentar el `DROP CONSTRAINT`, también (por la primera sentencia).
 */
const RAIZ = join(__dirname, "../../prisma/migrations");
const M1 = "20261015110000_proveedor_ofrece_productos_y_servicios";
const E = "empresa_m1";
const CHECK = "Proveedor_ofrece_productos_o_servicios_chk";

let base: BaseTemporalMigrada;
let hayRol = false;

const archivo = (nombre: "migration.sql" | "down.sql") => readFileSync(join(RAIZ, M1, nombre), "utf8");
/** Una sola consulta con todo el archivo (protocolo simple de `pg`: una transacción implícita, como `psql -1`). */
const correr = (nombre: "migration.sql" | "down.sql") => base.cliente.query(archivo(nombre));
const q = <T extends object = Record<string, unknown>>(texto: string, params: unknown[] = []) => base.cliente.query<T>(texto, params).then((r) => r.rows);

/** Una foto del catálogo de la tabla "Proveedor": lo único que M1 toca. */
async function foto() {
  return {
    columnas: await q(`SELECT column_name::text AS columna, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Proveedor' ORDER BY ordinal_position`),
    restricciones: await q(`SELECT conname::text AS nombre, contype, convalidated, pg_get_constraintdef(oid) AS definicion FROM pg_constraint WHERE conrelid = '"Proveedor"'::regclass ORDER BY 1`),
    indices: await q(`SELECT indexname::text AS nombre, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'Proveedor' ORDER BY 1`),
    politicas: await q(`SELECT policyname::text AS nombre, permissive, roles::text AS roles, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public' AND tablename = 'Proveedor' ORDER BY 1`),
    rls: await q(`SELECT relrowsecurity AS rls, relforcerowsecurity AS forzado FROM pg_class WHERE oid = '"Proveedor"'::regclass`),
    privilegios: await q(`SELECT grantee::text AS rol, privilege_type FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'Proveedor' AND grantee = 'motor2_app' ORDER BY 1, 2`),
  };
}

const proveedorPrevio = () => q(`SELECT "id", "empresaId", "codigo", "nombre", "cuit", "activo" FROM "Proveedor" WHERE "id" = 'prov_previo'`);
const clasificacionDelPrevio = () => q(`SELECT "ofreceProductos", "ofreceServicios" FROM "Proveedor" WHERE "id" = 'prov_previo'`);
const hayCheck = async () => (await q(`SELECT 1 FROM pg_constraint WHERE conrelid = '"Proveedor"'::regclass AND conname = $1`, [CHECK])).length === 1;

let antesDeM1: Awaited<ReturnType<typeof foto>>;
let arribaLaPrimeraVez: Awaited<ReturnType<typeof foto>>;

beforeAll(async () => {
  base = await crearBaseTemporalMigrada();
  hayRol = (await base.cliente.query("SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app'")).rowCount === 1;
  if (!hayRol) return; // sin el rol, las migraciones previas con `CREATE POLICY … TO motor2_app` fallan: el archivo omite sus casos con motivo (como los demás tests de RLS).
  await base.aplicarAntesDe(M1);
  await base.cliente.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO motor2_app`);
  // El «dato real previo»: una empresa y un proveedor que existían antes de M1. Ninguna reversa de M1 los borra.
  await base.cliente.query(`INSERT INTO "Empresa" ("id","nombre","slug","zonaHoraria","moneda","estado") VALUES ($1,$1,$1,'America/Argentina/Buenos_Aires','ARS','ACTIVE')`, [E]);
  await base.cliente.query(`INSERT INTO "Proveedor" ("id","empresaId","codigo","nombre","cuit","activo") VALUES ('prov_previo',$1,'PRV_PREVIO','Proveedor previo','30703088534',false)`, [E]);
  antesDeM1 = await foto();
}, 120_000);

afterAll(async () => {
  await base?.eliminar();
});

describe("M1: subir, bajar y subir (clasificación del proveedor) sobre una base temporal", () => {
  it("1. ANTES de M1: el proveedor existe y la tabla no tiene ni las columnas ni el CHECK", async (ctx) => {
    if (!hayRol) return ctx.skip();
    expect(await proveedorPrevio()).toHaveLength(1);
    expect(antesDeM1.columnas.map((c) => c.columna)).not.toContain("ofreceProductos");
    expect(antesDeM1.columnas.map((c) => c.columna)).not.toContain("ofreceServicios");
    expect(await hayCheck()).toBe(false);
  });

  it("2. SUBIR: el proveedor previo queda «productos» (true, false) sin otro cambio, y el CHECK queda puesto y validado", async (ctx) => {
    if (!hayRol) return ctx.skip();
    const previo = await proveedorPrevio();
    await correr("migration.sql");
    expect(await clasificacionDelPrevio()).toEqual([{ ofreceProductos: true, ofreceServicios: false }]);
    expect(await proveedorPrevio(), "ningún otro dato del proveedor cambia").toEqual(previo);
    expect(await q(`SELECT convalidated FROM pg_constraint WHERE conname = $1`, [CHECK])).toEqual([{ convalidated: true }]);
    arribaLaPrimeraVez = await foto();
    expect(arribaLaPrimeraVez.columnas.length, "sanidad de la foto").toBe(antesDeM1.columnas.length + 2);
    await expect(base.cliente.query(`UPDATE "Proveedor" SET "ofreceProductos" = false, "ofreceServicios" = false WHERE "id" = 'prov_previo'`)).rejects.toThrow(new RegExp(CHECK));
  });

  it("3. BAJAR: el catálogo de «Proveedor» queda como estaba antes de M1 y el proveedor previo sigue con sus datos", async (ctx) => {
    if (!hayRol) return ctx.skip();
    const previo = await proveedorPrevio();
    await correr("down.sql");
    const despues = await foto();
    for (const k of Object.keys(antesDeM1) as (keyof typeof antesDeM1)[]) expect(despues[k], `catálogo «${k}» igual que antes de M1`).toEqual(antesDeM1[k]);
    expect(await proveedorPrevio()).toEqual(previo);
  });

  it("3b. La primera sentencia de la reversa ya saca el CHECK (no depende de que DROP COLUMN lo arrastre)", async (ctx) => {
    if (!hayRol) return ctx.skip();
    await correr("migration.sql");
    const sentencias = archivo("down.sql")
      .split(";\n")
      .map((s) => s.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").trim())
      .filter((s) => s.length > 0);
    expect(sentencias).toHaveLength(3);
    await base.cliente.query(sentencias[0]!);
    expect(await hayCheck(), "tras la primera sentencia el CHECK ya no está").toBe(false);
    expect((await foto()).columnas.map((c) => c.columna), "y las columnas todavía sí").toContain("ofreceServicios");
    await correr("down.sql");
  });

  it("4. SUBIR OTRA VEZ: el catálogo es idéntico al de la primera subida y el proveedor sigue", async (ctx) => {
    if (!hayRol) return ctx.skip();
    await correr("migration.sql");
    expect(await foto()).toEqual(arribaLaPrimeraVez);
    expect(await clasificacionDelPrevio()).toEqual([{ ofreceProductos: true, ofreceServicios: false }]);
  });

  it("5. IDEMPOTENCIA: subir dos veces seguidas y bajar dos veces seguidas no falla ni cambia el catálogo", async (ctx) => {
    if (!hayRol) return ctx.skip();
    await correr("migration.sql");
    await correr("migration.sql");
    expect(await foto()).toEqual(arribaLaPrimeraVez);
    await correr("down.sql");
    await correr("down.sql");
    expect(await foto()).toEqual(antesDeM1);
    expect(await proveedorPrevio()).toHaveLength(1);
  });
});
