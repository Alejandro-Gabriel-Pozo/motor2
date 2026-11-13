import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";

/**
 * Paso 11 (nombre único sin distinguir mayúsculas): SUBIR, BAJAR y SUBIR de la migración real `20261112170000_nombre_unico_sin_mayusculas` sobre una base TEMPORAL descartable (`crearBaseTemporalMigrada`: solo Postgres
 * local, jamás una base real), con su `down.sql` tal cual está en el repo. La aplicación a bases reales NO sale de esta rama: la hace la coordinación con respaldo y ensayo.
 *
 * Qué comprueba:
 *  0. La migración existe, avisa que requiere autorización y tiene down.sql.
 *  1. SUBIR: los dos índices existen, son únicos y están VALIDOS (`indisunique`, `indisvalid`) sobre (empresaId, lower(nombre)); el duplicado «de otra capitalización» se rechaza (23505) en la MISMA empresa y pasa en OTRA empresa;
 *     las altas normales (lo que hace el código anterior: un nombre nuevo) siguen entrando; las filas sembradas antes no cambian; el resto del catálogo no cambia (los únicos de siempre se quedan).
 *  2. BAJAR: los dos índices ya no existen, los datos quedan intactos, el catálogo queda IDÉNTICO al de antes; bajar dos veces no falla. SIN índice, el código nuevo no se rompe: una alta normal funciona y solo vuelve el
 *     comportamiento de antes (sin protección de la carrera: «Pepe» y «pepe» entran los dos; la app los rechaza con su lectura previa, no la base).
 *  3. SUBIR otra vez: el catálogo queda idéntico al de la primera subida. Subir con dos nombres que difieren solo en mayúsculas ABORTA y no deja ningún índice (ni inválido) a medias.
 *
 * Mutación (anotada en el commit): sacar un DROP del down.sql → rojo el caso 2; cambiar `lower("nombre")` por `"nombre"` en la migración → rojo el caso 1 (el duplicado de otra capitalización entra).
 */
const RAIZ = join(__dirname, "../../prisma/migrations");
const MIGRACION = "20261112170000_nombre_unico_sin_mayusculas";
const sql = (archivo: "migration.sql" | "down.sql") => readFileSync(join(RAIZ, MIGRACION, archivo), "utf8");
const INDICES = ["Cliente_empresaId_nombre_lower_key", "SeccionCarta_empresaId_nombre_lower_key"];

const E1 = "empresa_p11a";
const E2 = "empresa_p11b";
let base: BaseTemporalMigrada;
const q = <T extends object = Record<string, unknown>>(texto: string, params: unknown[] = []) => base.cliente.query<T>(texto, params).then((r) => r.rows);

async function foto() {
  return {
    tablas: await q(`SELECT relname::text AS tabla, relrowsecurity AS rls FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' ORDER BY 1`),
    columnas: await q(`SELECT table_name::text AS tabla, column_name::text AS columna, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' ORDER BY 1, ordinal_position`),
    indices: await q(`SELECT tablename::text AS tabla, indexname::text AS nombre, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY 1, 2`),
    restricciones: await q(`SELECT conrelid::regclass::text AS tabla, conname::text AS nombre, contype, convalidated, pg_get_constraintdef(oid) AS definicion FROM pg_constraint WHERE connamespace = 'public'::regnamespace ORDER BY 1, 2`),
    politicas: await q(`SELECT tablename::text AS tabla, policyname::text AS nombre, permissive, roles::text AS roles, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public' ORDER BY 1, 2`),
    privilegios: await q(`SELECT table_name::text AS tabla, grantee::text AS rol, privilege_type FROM information_schema.role_table_grants WHERE table_schema = 'public' AND grantee IN ('motor2_app', 'motor2_plataforma') ORDER BY 1, 2, 3`),
  };
}
type Foto = Awaited<ReturnType<typeof foto>>;
const sinLosIndices = (f: Foto) => ({ ...f, indices: f.indices.filter((i) => !INDICES.includes(i.nombre as string)) });
const datos = async () => ({
  empresas: await q(`SELECT * FROM "Empresa" ORDER BY id`),
  clientes: await q(`SELECT * FROM "Cliente" ORDER BY id`),
  secciones: await q(`SELECT * FROM "SeccionCarta" ORDER BY id`),
});
const catalogoDeLosIndices = () =>
  q<{ nombre: string; indisunique: boolean; indisvalid: boolean; definicion: string }>(
    `SELECT c.relname::text AS nombre, i.indisunique, i.indisvalid, pg_get_indexdef(i.indexrelid) AS definicion FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = ANY($1::text[]) ORDER BY 1`,
    [INDICES],
  );

/** Devuelve el nombre del índice único violado, `null` si la sentencia entró. */
async function resultado(texto: string, params: unknown[] = []): Promise<string | null> {
  try {
    await base.cliente.query(texto, params);
    return null;
  } catch (e) {
    const m = /duplicate key value violates unique constraint "([^"]+)"/.exec((e as Error).message);
    return m ? m[1]! : `otro error: ${(e as Error).message}`;
  }
}
const altaCliente = (id: string, empresa: string, nombre: string) => resultado(`INSERT INTO "Cliente" ("id","empresaId","nombre","descuentoPorcentaje") VALUES ($1,$2,$3,0)`, [id, empresa, nombre]);
const altaSeccion = (id: string, empresa: string, nombre: string) => resultado(`INSERT INTO "SeccionCarta" ("id","empresaId","nombre") VALUES ($1,$2,$3)`, [id, empresa, nombre]);
const borrarPruebas = async () => {
  await q(`DELETE FROM "Cliente" WHERE id LIKE 'x_%'`);
  await q(`DELETE FROM "SeccionCarta" WHERE id LIKE 'x_%'`);
};

let antes: Foto;
let arriba: Foto;
let datosSembrados: Awaited<ReturnType<typeof datos>>;

beforeAll(async () => {
  base = await crearBaseTemporalMigrada();
  await base.aplicarAntesDe(MIGRACION);
  for (const e of [E1, E2]) await q(`INSERT INTO "Empresa" ("id","nombre","slug","zonaHoraria","moneda","estado") VALUES ($1,$1,$1,'America/Argentina/Buenos_Aires','ARS','ACTIVE')`, [e]);
  await q(`INSERT INTO "Cliente" ("id","empresaId","nombre","descuentoPorcentaje") VALUES ('c_ana',$1,'Ana',10), ('c_luis',$1,'Luis',0)`, [E1]);
  await q(`INSERT INTO "SeccionCarta" ("id","empresaId","nombre") VALUES ('s_postres',$1,'Postres'), ('s_bebidas',$1,'Bebidas')`, [E1]);
  antes = await foto();
  datosSembrados = await datos();
}, 180_000);

afterAll(async () => {
  await base?.eliminar();
}, 60_000);

const correr = (archivo: "migration.sql" | "down.sql") => base.cliente.query(sql(archivo));

describe("Paso 11, nombre único sin mayúsculas: subir, bajar y subir sobre una base temporal con todo lo anterior aplicado", () => {
  it("0. la migración existe, avisa la autorización y tiene down.sql", () => {
    expect(readdirSync(RAIZ)).toContain(MIGRACION);
    expect(sql("migration.sql").split("\n").slice(0, 3).join("\n")).toContain("REQUIERE AUTORIZACIÓN EXPRESA");
    expect(sql("down.sql").length).toBeGreaterThan(0);
  });

  it("antes de subir: no hay índices por lower(nombre) y el duplicado de otra capitalización entra (es lo que la migración viene a cerrar)", async () => {
    expect(await catalogoDeLosIndices()).toEqual([]);
    expect(await altaCliente("x_ana", E1, "ANA")).toBeNull();
    expect(await altaSeccion("x_postres", E1, "POSTRES")).toBeNull();
    // Los únicos de siempre, por nombre exacto, ya existían.
    expect(await altaCliente("x_ana2", E1, "Ana")).toMatch(/Cliente_empresaId_nombre_key/);
    await borrarPruebas();
    expect(await datos()).toEqual(datosSembrados);
  });

  it("1. SUBIR: dos índices únicos válidos por (empresa, lower(nombre)); rechazan el duplicado de otra capitalización en la misma empresa y dejan pasar lo normal; nada más cambia", async () => {
    await correr("migration.sql");
    const f = await foto();
    // Lo ÚNICO que cambia respecto de antes: los dos índices.
    expect(sinLosIndices(f)).toEqual(sinLosIndices(antes));
    const indices = await catalogoDeLosIndices();
    expect(indices.map((i) => [i.nombre, i.indisunique, i.indisvalid]), "los dos son únicos y válidos").toEqual(INDICES.map((n) => [n, true, true]));
    expect(indices.find((i) => i.nombre === INDICES[0])?.definicion).toMatch(/ON public\."Cliente" USING btree \("empresaId", lower\(nombre\)\)/);
    expect(indices.find((i) => i.nombre === INDICES[1])?.definicion).toMatch(/ON public\."SeccionCarta" USING btree \("empresaId", lower\(nombre\)\)/);

    // Lo inválido: mismo nombre sin distinguir mayúsculas en la misma empresa.
    expect(await altaCliente("x_ana", E1, "ANA")).toBe(INDICES[0]);
    expect(await altaCliente("x_ana", E1, "aNa")).toBe(INDICES[0]);
    expect(await altaSeccion("x_postres", E1, "POSTRES")).toBe(INDICES[1]);
    // Lo válido (lo que hace el código anterior, y el nuevo): un nombre nuevo, o el mismo nombre en OTRA empresa.
    expect(await altaCliente("x_nuevo", E1, "Pepe")).toBeNull();
    expect(await altaCliente("x_otra", E2, "ANA")).toBeNull();
    expect(await altaSeccion("x_nueva", E1, "Entradas")).toBeNull();
    expect(await altaSeccion("x_otra", E2, "POSTRES")).toBeNull();
    // Renombrar a un nombre ya tomado (otra capitalización) también se rechaza; a uno libre pasa.
    expect(await resultado(`UPDATE "Cliente" SET "nombre" = 'LUIS' WHERE id = 'x_nuevo'`)).toBe(INDICES[0]);
    expect(await resultado(`UPDATE "Cliente" SET "nombre" = 'Pepe Grillo' WHERE id = 'x_nuevo'`)).toBeNull();
    await borrarPruebas();
    expect(await datos(), "las filas de antes no cambiaron").toEqual(datosSembrados);
    arriba = f;
  });

  it("2. BAJAR: los índices desaparecen, los datos quedan intactos, el catálogo es idéntico al de antes; el código nuevo sin índice no se rompe; bajar dos veces no falla", async () => {
    await correr("down.sql");
    expect(await foto(), "tras bajar, el catálogo es idéntico al de antes de la migración").toEqual(antes);
    expect(await catalogoDeLosIndices()).toEqual([]);
    expect(await datos(), "bajar no toca ningún dato").toEqual(datosSembrados);
    // Sin índice: el alta normal (nombre nuevo) funciona; el código nuevo solo pierde la protección de la carrera, no se rompe.
    expect(await altaCliente("x_nuevo", E1, "Pepe")).toBeNull();
    expect(await altaSeccion("x_nueva", E1, "Entradas")).toBeNull();
    expect(await altaCliente("x_nuevo_otra_caja", E1, "pepe"), "sin el índice, la base vuelve a dejar pasar la otra capitalización (la app la sigue rechazando con su lectura previa)").toBeNull();
    expect(await altaCliente("x_exacto", E1, "Pepe"), "el único de siempre, por nombre exacto, sigue ahí").toMatch(/Cliente_empresaId_nombre_key/);
    await borrarPruebas();
    // Idempotente: repetir el down no falla y no cambia nada.
    await correr("down.sql");
    await correr("down.sql");
    expect(await foto()).toEqual(antes);
    expect(await datos()).toEqual(datosSembrados);
  });

  it("3. SUBIR otra vez deja el catálogo idéntico al de la primera subida", async () => {
    await correr("migration.sql");
    expect(await foto()).toEqual(arriba);
    expect(await altaCliente("x_ana", E1, "ANA")).toBe(INDICES[0]);
    expect(await datos()).toEqual(datosSembrados);
    await correr("down.sql");
    expect(await foto()).toEqual(antes);
  });

  it("4. con dos nombres que difieren solo en mayúsculas ya guardados, subir ABORTA y no deja ningún índice a medias; al limpiar, sube bien", async () => {
    expect(await altaSeccion("x_dup", E1, "POSTRES")).toBeNull();
    await expect(correr("migration.sql")).rejects.toThrow(/duplicate key|could not create unique index/);
    expect(await foto(), "la subida abortada no dejó nada a medias").toEqual(antes);
    expect(await catalogoDeLosIndices()).toEqual([]);
    await borrarPruebas();
    await correr("migration.sql");
    expect(await foto()).toEqual(arriba);
  });
});
