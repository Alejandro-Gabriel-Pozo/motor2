import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";

/**
 * Etapa a2-1 (relajar el único (producto, unidad) de la presentación): SUBIR, BAJAR y SUBIR de la migración real `20261115151000_presentacion_unico_de_unidad_a_indice` sobre una base TEMPORAL descartable (solo Postgres local,
 * jamás una base real), con su `down.sql` tal cual está en el repo.
 *
 *  0. Existe, avisa la autorización y trae down.sql y verificacion-previa.sql.
 *  1. ANTES: el índice es ÚNICO y dos presentaciones del mismo producto con la misma unidad se rechazan.
 *  2. SUBIR: el índice único desaparece y aparece el común (no único, válido) sobre (productoId, unidadCompraId); lo único que cambia del catálogo es ese índice; las filas quedan idénticas; «Bolsa x20» y «Bolsa x10» con la misma unidad conviven,
 *     pero el MISMO nombre (otra capitalización) en el mismo producto se sigue rechazando (el único del nombre, de la etapa a).
 *  3. BAJAR con duplicados: SE FRENA con error y no toca NADA (ni índice ni filas). Sin duplicados: baja, el catálogo queda IDÉNTICO al de antes y vuelve a rechazar el par repetido; bajar dos veces no falla.
 *  4. SUBIR otra vez deja el catálogo idéntico al de la primera subida.
 *
 * Mutación (anotada en el commit): sacar el DO del down.sql → rojo el caso 3 (baja con duplicados y falla al recrear el único, o lo hace a medias); no crear el índice común en la migración → rojo el caso 2.
 */
const RAIZ = join(__dirname, "../../prisma/migrations");
const MIGRACION = "20261115151000_presentacion_unico_de_unidad_a_indice";
const sql = (archivo: "migration.sql" | "down.sql") => readFileSync(join(RAIZ, MIGRACION, archivo), "utf8");
const UNICO = "Presentacion_productoId_unidadCompraId_key";
const COMUN = "Presentacion_productoId_unidadCompraId_idx";
const E = "empresa_a2";

let base: BaseTemporalMigrada;
const q = <T extends object = Record<string, unknown>>(texto: string, params: unknown[] = []) => base.cliente.query<T>(texto, params).then((r) => r.rows);
async function foto() {
  return {
    columnas: await q(`SELECT table_name::text AS tabla, column_name::text AS columna, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' ORDER BY 1, ordinal_position`),
    indices: await q(`SELECT tablename::text AS tabla, indexname::text AS nombre, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY 1, 2`),
    restricciones: await q(`SELECT conrelid::regclass::text AS tabla, conname::text AS nombre, contype, convalidated, pg_get_constraintdef(oid) AS definicion FROM pg_constraint WHERE connamespace = 'public'::regnamespace ORDER BY 1, 2`),
    politicas: await q(`SELECT tablename::text AS tabla, policyname::text AS nombre, qual, with_check FROM pg_policies WHERE schemaname = 'public' ORDER BY 1, 2`),
    privilegios: await q(`SELECT table_name::text AS tabla, grantee::text AS rol, privilege_type FROM information_schema.role_table_grants WHERE table_schema = 'public' AND grantee IN ('motor2_app', 'motor2_plataforma') ORDER BY 1, 2, 3`),
  };
}
type Foto = Awaited<ReturnType<typeof foto>>;
const sinLosIndices = (f: Foto): Foto => ({ ...f, indices: f.indices.filter((i) => ![UNICO, COMUN].includes(i.nombre as string)) });
const filas = () => q(`SELECT * FROM "Presentacion" ORDER BY "id"`);
async function resultado(texto: string, params: unknown[] = []): Promise<string | null> {
  try {
    await base.cliente.query(texto, params);
    return null;
  } catch (e) {
    const m = /duplicate key value violates unique constraint "([^"]+)"/.exec((e as Error).message);
    return m ? m[1]! : `otro error: ${(e as Error).message}`;
  }
}
const alta = (id: string, nombre: string, unidad = "u_caja") => resultado(`INSERT INTO "Presentacion" ("id","empresaId","productoId","unidadCompraId","factorConversion","nombre") VALUES ($1,$2,'p_h',$3,10,$4)`, [id, E, unidad, nombre]);
const indicesDeLaTabla = () => q<{ nombre: string; indisunique: boolean; indisvalid: boolean }>(`SELECT c.relname::text AS nombre, i.indisunique, i.indisvalid FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = ANY($1::text[]) ORDER BY 1`, [[UNICO, COMUN]]);

let antes: Foto;
let arriba: Foto;
let sembradas: Awaited<ReturnType<typeof filas>>;
const correr = (archivo: "migration.sql" | "down.sql") => base.cliente.query(sql(archivo));

beforeAll(async () => {
  base = await crearBaseTemporalMigrada();
  await base.aplicarAntesDe(MIGRACION);
  await q(`INSERT INTO "Empresa" ("id","nombre","slug","zonaHoraria","moneda","estado") VALUES ($1,$1,$1,'America/Argentina/Buenos_Aires','ARS','ACTIVE')`, [E]);
  await q(`INSERT INTO "Unidad" ("id","empresaId","nombre","magnitud") VALUES ('u_kg',$1,'kg','PESO'), ('u_caja',$1,'caja','CANTIDAD'), ('u_bolsa',$1,'bolsa','CANTIDAD')`, [E]);
  await q(`INSERT INTO "Producto" ("id","empresaId","codigo","nombre","tipo","unidadStockId") VALUES ('p_h',$1,'MP_h','Harina','MP','u_kg')`, [E]);
  await q(`INSERT INTO "Presentacion" ("id","empresaId","productoId","unidadCompraId","factorConversion","nombre") VALUES ('pr_bolsa',$1,'p_h','u_bolsa',25,'Bolsa x25')`, [E]);
  antes = await foto();
  sembradas = await filas();
}, 180_000);
afterAll(async () => {
  await base?.eliminar();
}, 60_000);

describe("Etapa a2-1, único (producto, unidad) → índice común: subir, bajar y subir", () => {
  it("0. existe, avisa la autorización y trae down.sql y verificacion-previa.sql", () => {
    expect(readdirSync(RAIZ)).toContain(MIGRACION);
    expect(readdirSync(join(RAIZ, MIGRACION)).sort()).toEqual(["down.sql", "migration.sql", "verificacion-previa.sql"]);
    expect(sql("migration.sql").split("\n").slice(0, 4).join("\n")).toContain("REQUIERE AUTORIZACIÓN EXPRESA");
  });

  it("1. antes: el índice es único y rechaza dos presentaciones del mismo producto con la misma unidad", async () => {
    expect(await indicesDeLaTabla()).toEqual([{ nombre: UNICO, indisunique: true, indisvalid: true }]);
    expect(await alta("x_1", "Caja x6")).toBeNull();
    expect(await alta("x_2", "Caja x12")).toBe(UNICO);
    await q(`DELETE FROM "Presentacion" WHERE id LIKE 'x_%'`);
    expect(await filas()).toEqual(sembradas);
  });

  it("2. SUBIR: el único se va, aparece el común; «caja x6» y «caja x12» conviven; el mismo nombre se sigue rechazando; las filas no cambian", async () => {
    await correr("migration.sql");
    const f = await foto();
    expect(sinLosIndices(f), "lo único que cambia es ese índice").toEqual(sinLosIndices(antes));
    expect(await indicesDeLaTabla()).toEqual([{ nombre: COMUN, indisunique: false, indisvalid: true }]);
    expect(await filas()).toEqual(sembradas);
    expect(await alta("x_1", "Caja x6")).toBeNull();
    expect(await alta("x_2", "Caja x12")).toBeNull();
    expect(await alta("x_3", "CAJA X12"), "el único del NOMBRE (etapa a) sigue").toBe("Presentacion_empresaId_productoId_nombre_lower_key");
    arriba = f;
  });

  it("3. BAJAR con dos presentaciones de la misma unidad: SE FRENA y no toca nada; sin duplicados baja y deja el catálogo idéntico", async () => {
    const fotoConDuplicados = await foto();
    const filasConDuplicados = await filas();
    await expect(correr("down.sql")).rejects.toThrow(/down\.sql frenado/);
    expect(await foto(), "frenado: ni el índice cambió").toEqual(fotoConDuplicados);
    expect(await filas(), "frenado: ni una fila cambió").toEqual(filasConDuplicados);
    await q(`DELETE FROM "Presentacion" WHERE id LIKE 'x_%'`);
    await correr("down.sql");
    expect(await foto(), "tras bajar, el catálogo es idéntico al de antes").toEqual(antes);
    expect(await filas()).toEqual(sembradas);
    expect(await alta("x_1", "Caja x6")).toBeNull();
    expect(await alta("x_2", "Caja x12"), "vuelve a rechazar el par repetido").toBe(UNICO);
    await q(`DELETE FROM "Presentacion" WHERE id LIKE 'x_%'`);
    await correr("down.sql");
    await correr("down.sql");
    expect(await foto()).toEqual(antes);
  });

  it("4. SUBIR otra vez deja el catálogo idéntico al de la primera subida", async () => {
    await correr("migration.sql");
    expect(await foto()).toEqual(arriba);
    expect(await filas()).toEqual(sembradas);
  });
});
