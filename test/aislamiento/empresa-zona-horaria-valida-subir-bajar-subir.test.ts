import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";

/**
 * Zona horaria de la empresa validada por la base (migración 20261117170000; frente 3, E-2; paridad con Pedernal `empresa_validar_zona_horaria`). SUBIR, BAJAR y SUBIR sobre una base TEMPORAL migrada como una real:
 *  - GUARDA: con una empresa de zona inventada la migración aborta y no deja nada (ni función ni disparador);
 *  - SUBIR: la función dice verdadero solo para nombres de `pg_timezone_names`; un alta o un cambio con zona inventada, vacía o nula se rechaza (23514); una zona real entra; un UPDATE de otra columna no revalida;
 *  - las empresas ya cargadas no cambian; BAJAR vuelve a aceptar cualquier texto y no pierde nada; bajar dos veces no falla; SUBIR OTRA VEZ deja el catálogo igual.
 * Contra Postgres local; nunca contra una base real.
 */
const RAIZ = join(__dirname, "../../prisma/migrations");
const MIGRACION = "20261117170000_empresa_zona_horaria_valida";
const BA = "America/Argentina/Buenos_Aires";

let base: BaseTemporalMigrada;
const sql = (archivo: "migration.sql" | "down.sql") => readFileSync(join(RAIZ, MIGRACION, archivo), "utf8");
const correr = (archivo: "migration.sql" | "down.sql") => base.cliente.query(sql(archivo));
const q = <T extends object = Record<string, unknown>>(texto: string, params: unknown[] = []) => base.cliente.query<T>(texto, params).then((r) => r.rows);
const falla = async (texto: string, params: unknown[] = []): Promise<string> => {
  await base.cliente.query("BEGIN");
  try {
    await base.cliente.query(texto, params);
    return "sin error";
  } catch (e) {
    return (e as { code?: string }).code ?? "sin código";
  } finally {
    await base.cliente.query("ROLLBACK");
  }
};
const alta = (id: string, zona: string | null) => `INSERT INTO "Empresa" ("id","nombre","slug","zonaHoraria","moneda","estado") VALUES ('${id}','${id}','${id}',${zona === null ? "NULL" : `'${zona}'`},'ARS','ACTIVE')`;
const porNombre = <T extends { nombre: string }>(filas: T[]) => [...filas].sort((a, b) => (a.nombre < b.nombre ? -1 : a.nombre > b.nombre ? 1 : 0));
const catalogo = async () => ({
  funciones: porNombre(await q<{ nombre: string }>(`SELECT proname::text AS nombre FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN ('zona_horaria_valida','empresa_validar_zona_horaria')`)),
  disparadores: porNombre(await q<{ nombre: string }>(`SELECT tgname::text AS nombre FROM pg_trigger WHERE tgrelid = 'public."Empresa"'::regclass AND NOT tgisinternal AND tgname = 'Empresa_zona_horaria_valida'`)),
});

beforeAll(async () => {
  base = await crearBaseTemporalMigrada();
  await base.aplicarAntesDe(MIGRACION);
  await q(alta("emp_ba", BA));
  await q(alta("emp_utc", "UTC"));
}, 300_000);

afterAll(async () => {
  await base?.eliminar();
});

describe("Empresa: zona horaria validada por la base (subir, bajar y subir)", () => {
  /** Sube la migración si todavía no está (cada caso se basta solo: no depende de que otro haya corrido). */
  const asegurarSubida = async () => {
    if ((await catalogo()).funciones.length === 0) await correr("migration.sql");
  };

  it("0. la migración existe, trae down.sql y verificacion-previa.sql", () => {
    expect(sql("migration.sql").split("\n")[0]).toBeTruthy();
    expect(sql("down.sql").length).toBeGreaterThan(0);
    expect(readFileSync(join(RAIZ, MIGRACION, "verificacion-previa.sql"), "utf8").length).toBeGreaterThan(0);
  });

  it("1. GUARDA: con una empresa de zona inventada la migración aborta y no deja nada", async () => {
    await q(alta("emp_mala", "Marte/Olympus_Mons"));
    await expect(correr("migration.sql")).rejects.toThrow(/emp_mala/);
    expect(await catalogo()).toEqual({ funciones: [], disparadores: [] });
    await q(`DELETE FROM "Empresa" WHERE "id" = 'emp_mala'`);
  });

  it("2. SUBIR: la función acepta nombres de pg_timezone_names y rechaza el resto; alta y cambio con zona mala se rechazan; los datos no cambian", async () => {
    await correr("migration.sql");
    expect(await q(`SELECT zona_horaria_valida($1) AS v, zona_horaria_valida('Marte/Olympus_Mons') AS m, zona_horaria_valida('') AS vacia, zona_horaria_valida(NULL) AS nula`, [BA])).toEqual([{ v: true, m: false, vacia: false, nula: false }]);
    expect(await falla(alta("emp_x", "Marte/Olympus_Mons"))).toBe("23514");
    expect(await falla(alta("emp_x", ""))).toBe("23514");
    expect(await falla(alta("emp_x", null))).toBe("23514");
    expect(await falla(`UPDATE "Empresa" SET "zonaHoraria" = 'inventada' WHERE "id" = 'emp_ba'`)).toBe("23514");
    expect(await falla(`UPDATE "Empresa" SET "zonaHoraria" = 'America/Montevideo' WHERE "id" = 'emp_ba'`)).toBe("sin error");
    // Sin depender del COLLATION de la base: se ordena acá, no en SQL.
    const empresas = (await q<{ id: string; zonaHoraria: string }>(`SELECT "id", "zonaHoraria" FROM "Empresa"`)).sort((a, b) => (a.id < b.id ? -1 : 1));
    expect(empresas).toEqual([{ id: "emp_ba", zonaHoraria: BA }, { id: "emp_utc", zonaHoraria: "UTC" }, { id: "empresa_principal", zonaHoraria: BA }]);
    expect((await catalogo()).disparadores).toEqual([{ nombre: "Empresa_zona_horaria_valida" }]);
  });

  it("3. una zona real entra y cambia; cambiar otra columna no revalida", async () => {
    await asegurarSubida();
    await q(alta("emp_nueva", "America/Montevideo"));
    await q(`UPDATE "Empresa" SET "zonaHoraria" = 'America/Sao_Paulo' WHERE "id" = 'emp_nueva'`);
    expect(await q(`SELECT "zonaHoraria" FROM "Empresa" WHERE "id" = 'emp_nueva'`)).toEqual([{ zonaHoraria: "America/Sao_Paulo" }]);
    await q(`UPDATE "Empresa" SET "nombre" = 'Otro nombre' WHERE "id" = 'emp_nueva'`);
    await q(`DELETE FROM "Empresa" WHERE "id" = 'emp_nueva'`);
  });

  it("4. BAJAR: vuelve a aceptar cualquier texto, no pierde empresas y se puede bajar dos veces", async () => {
    await asegurarSubida();
    await correr("down.sql");
    expect(await catalogo()).toEqual({ funciones: [], disparadores: [] });
    expect(await falla(`UPDATE "Empresa" SET "zonaHoraria" = 'inventada' WHERE "id" = 'emp_utc'`)).toBe("sin error");
    expect(await q(`SELECT count(*)::int AS n FROM "Empresa" WHERE "id" IN ('emp_ba','emp_utc')`)).toEqual([{ n: 2 }]);
    await correr("down.sql");
  });

  it("5. SUBIR OTRA VEZ: el catálogo queda idéntico al de la subida anterior", async () => {
    await asegurarSubida();
    const subida = await catalogo();
    await correr("down.sql");
    await correr("migration.sql");
    expect(await catalogo()).toEqual(subida);
    expect(await falla(`UPDATE "Empresa" SET "zonaHoraria" = 'inventada' WHERE "id" = 'emp_utc'`)).toBe("23514");
  });
});
