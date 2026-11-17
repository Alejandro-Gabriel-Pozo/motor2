import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";

/**
 * Carta, orden de renglones O1: la tabla `ModoDeOrdenDeSeccionCarta` y sus políticas de alcance de sucursal (migraciones 20261117160000 y 20261117160100). SUBIR, BAJAR y SUBIR sobre una base TEMPORAL migrada como una real.
 * Prueba: ANTES la tabla no existe; SUBIR la crea con su lista cerrada de modos, su único por (sucursal, sección) y las cuatro políticas; la base decide (modo fuera de la lista, versión 0, un segundo modo para la misma
 * sucursal y sección, una sección de otra empresa); BAJAR CON FILAS aborta y no pierde nada; con la tabla vacía baja, y bajar dos veces no falla; SUBIR OTRA VEZ deja el catálogo idéntico al de la primera subida.
 * Contra Postgres local; nunca contra una base real.
 */
const RAIZ = join(__dirname, "../../prisma/migrations");
const TABLA = "20261117160000_modo_de_orden_de_seccion_carta";
const POLITICAS = "20261117160100_rls_sucursal_modo_de_orden_de_seccion_carta";
const E = "empresa_modo";
const E2 = "empresa_modo_2";
const ID1 = "00000000-0000-4000-8000-0000000000b1";
const ID2 = "00000000-0000-4000-8000-0000000000b2";

let base: BaseTemporalMigrada;
const leer = (migracion: string, archivo: "migration.sql" | "down.sql") => readFileSync(join(RAIZ, migracion, archivo), "utf8");
const correr = (migracion: string, archivo: "migration.sql" | "down.sql") => base.cliente.query(leer(migracion, archivo));
const q = <T extends object = Record<string, unknown>>(texto: string, params: unknown[] = []) => base.cliente.query<T>(texto, params).then((r) => r.rows);
const existe = async () => (await q(`SELECT to_regclass('public."ModoDeOrdenDeSeccionCarta"')::text AS t`))[0].t !== null;
const falla = async (texto: string, params: unknown[] = []): Promise<string> => {
  await base.cliente.query("BEGIN");
  try {
    await base.cliente.query(texto, params);
    return "sin error";
  } catch (e) {
    return (e as { code?: string; message?: string }).code ?? (e as Error).message;
  } finally {
    await base.cliente.query("ROLLBACK");
  }
};
const insertar = (id: string, modo: string, version = 1, sucursal = "suc_modo", seccion = "sec_modo", empresa = E) =>
  q(`INSERT INTO "ModoDeOrdenDeSeccionCarta" ("id","empresaId","sucursalId","seccionCartaId","modo","actualizadoPorId","actualizadoEn","version") VALUES ($1,$2,$3,$4,$5,'u_modo',now(),$6)`, [id, empresa, sucursal, seccion, modo, version]);

async function foto() {
  return {
    columnas: await q(`SELECT column_name::text AS columna, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ModoDeOrdenDeSeccionCarta' ORDER BY 1`),
    restricciones: await q(`SELECT conname::text AS nombre, pg_get_constraintdef(oid) AS definicion FROM pg_constraint WHERE conrelid = 'public."ModoDeOrdenDeSeccionCarta"'::regclass ORDER BY 1`),
    indices: await q(`SELECT indexname::text AS nombre, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'ModoDeOrdenDeSeccionCarta' ORDER BY 1`),
    politicas: await q(`SELECT policyname::text AS nombre, cmd::text, permissive::text, qual, with_check FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ModoDeOrdenDeSeccionCarta' ORDER BY 1`),
    privilegios: await q(`SELECT privilege_type::text AS p FROM information_schema.role_table_grants WHERE table_name = 'ModoDeOrdenDeSeccionCarta' AND grantee = 'motor2_app' ORDER BY 1`),
    columnasConUpdate: await q(`SELECT column_name::text AS c FROM information_schema.column_privileges WHERE table_name = 'ModoDeOrdenDeSeccionCarta' AND grantee = 'motor2_app' AND privilege_type = 'UPDATE' ORDER BY 1`),
  };
}

beforeAll(async () => {
  base = await crearBaseTemporalMigrada();
  await base.aplicarAntesDe(TABLA);
  for (const e of [E, E2]) await q(`INSERT INTO "Empresa" ("id","nombre","slug","zonaHoraria","moneda","estado") VALUES ($1,$1,$1,'America/Argentina/Buenos_Aires','ARS','ACTIVE')`, [e]);
  await q(`INSERT INTO "Sucursal" ("id","empresaId","nombre") VALUES ('suc_modo',$1,'Centro'), ('suc_modo_2',$1,'Norte')`, [E]);
  await q(`INSERT INTO "SeccionCarta" ("id","empresaId","nombre") VALUES ('sec_modo',$1,'Bebidas'), ('sec_ajena',$2,'Ajena')`, [E, E2]);
  await q(`INSERT INTO "User" ("id","email") VALUES ('u_modo','modo@ejemplo.test')`);
}, 300_000);

afterAll(async () => {
  await base?.eliminar();
});

describe("ModoDeOrdenDeSeccionCarta (subir, bajar y subir)", () => {
  let primeraSubida: Awaited<ReturnType<typeof foto>>;

  it("ANTES: la tabla no existe", async () => {
    expect(await existe()).toBe(false);
  });

  it("SUBIR: la tabla nace vacía con su único, su lista cerrada de modos, las tres claves, la RLS y los privilegios de la app (leer, agregar y cambiar solo 4 columnas; sin borrar)", async () => {
    await correr(TABLA, "migration.sql");
    await correr(POLITICAS, "migration.sql");
    expect(await existe()).toBe(true);
    expect(await q(`SELECT count(*)::int AS n FROM "ModoDeOrdenDeSeccionCarta"`)).toEqual([{ n: 0 }]);
    const f = await foto();
    expect(f.indices.map((i) => i.nombre)).toEqual(
      expect.arrayContaining(["ModoDeOrdenDeSeccionCarta_pkey", "ModoDeOrdenDeSeccionCarta_empresaId_id_key", "ModoDeOrdenDeSeccionCarta_sucursalId_seccionCartaId_key", "ModoDeOrdenDeSeccionCarta_seccionCartaId_idx"]),
    );
    expect(f.politicas.map((p) => p.nombre)).toEqual(["alcance_sucursal_delete", "alcance_sucursal_insert", "alcance_sucursal_select", "alcance_sucursal_update", "aislamiento_empresa"].sort());
    expect(f.privilegios).toEqual([{ p: "INSERT" }, { p: "SELECT" }]);
    expect(f.columnasConUpdate).toEqual([{ c: "actualizadoEn" }, { c: "actualizadoPorId" }, { c: "modo" }, { c: "version" }]);
    expect(f.columnas.find((c) => c.columna === "id")).toMatchObject({ data_type: "uuid" });
    expect(f.columnas.find((c) => c.columna === "actualizadoEn")).toMatchObject({ data_type: "timestamp with time zone", column_default: null });
    primeraSubida = f;
  });

  it("la base decide: un modo fuera de la lista (23514), la versión 0 (23514), un segundo modo para la misma sucursal y sección (23505), una sección de otra empresa (23503) y un id que no es uuid (22P02)", async () => {
    expect(await falla(`INSERT INTO "ModoDeOrdenDeSeccionCarta" ("id","empresaId","sucursalId","seccionCartaId","modo","actualizadoPorId","actualizadoEn") VALUES ($1,$2,'suc_modo','sec_modo','AL_AZAR','u_modo',now())`, [ID1, E])).toBe("23514");
    expect(await falla(`INSERT INTO "ModoDeOrdenDeSeccionCarta" ("id","empresaId","sucursalId","seccionCartaId","modo","actualizadoPorId","actualizadoEn","version") VALUES ($1,$2,'suc_modo','sec_modo','A_MANO','u_modo',now(),0)`, [ID1, E])).toBe("23514");
    await insertar(ID1, "ALFABETICO");
    expect(await falla(`INSERT INTO "ModoDeOrdenDeSeccionCarta" ("id","empresaId","sucursalId","seccionCartaId","modo","actualizadoPorId","actualizadoEn") VALUES ($1,$2,'suc_modo','sec_modo','A_MANO','u_modo',now())`, [ID2, E])).toBe("23505");
    expect(await falla(`INSERT INTO "ModoDeOrdenDeSeccionCarta" ("id","empresaId","sucursalId","seccionCartaId","modo","actualizadoPorId","actualizadoEn") VALUES ($1,$2,'suc_modo_2','sec_ajena','A_MANO','u_modo',now())`, [ID2, E])).toBe("23503");
    expect(await falla(`INSERT INTO "ModoDeOrdenDeSeccionCarta" ("id","empresaId","sucursalId","seccionCartaId","modo","actualizadoPorId","actualizadoEn") VALUES ('no-es-uuid',$1,'suc_modo_2','sec_modo','A_MANO','u_modo',now())`, [E])).toBe("22P02");
    // Otra sucursal, misma sección: sí puede (el modo es por sucursal).
    await insertar(ID2, "A_MANO", 1, "suc_modo_2");
    expect(await q(`SELECT count(*)::int AS n FROM "ModoDeOrdenDeSeccionCarta"`)).toEqual([{ n: 2 }]);
  });

  it("BAJAR CON FILAS aborta y no pierde nada; con la tabla vacía baja (políticas primero), y bajar dos veces no falla", async () => {
    expect(await falla(leer(TABLA, "down.sql"))).toBe("P0001");
    expect(await q(`SELECT count(*)::int AS n FROM "ModoDeOrdenDeSeccionCarta"`)).toEqual([{ n: 2 }]);
    await q(`DELETE FROM "ModoDeOrdenDeSeccionCarta"`);
    await correr(POLITICAS, "down.sql");
    expect((await foto()).politicas.map((p) => p.nombre)).toEqual(["aislamiento_empresa"]);
    await correr(TABLA, "down.sql");
    expect(await existe()).toBe(false);
    await correr(TABLA, "down.sql");
    expect(await existe()).toBe(false);
  });

  it("SUBIR OTRA VEZ: el catálogo de la tabla queda idéntico al de la primera subida", async () => {
    await correr(TABLA, "migration.sql");
    await correr(POLITICAS, "migration.sql");
    expect(await foto()).toEqual(primeraSubida);
  });
});
