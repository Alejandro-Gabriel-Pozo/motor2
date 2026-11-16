import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CODIGOS_DE_UNIDAD } from "@/core/catalogo/unidades-de-medida";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";

/**
 * Unidades de medida como Pedernal, etapa U1 (2026-11-17) — migración 20261117130000_unidad_codigo_fijo: `Unidad.codigoFijo` (TEXT NULL) con el CHECK `Unidad_codigoFijo_chk` de las 14
 * unidades fijas. Sobre una base temporal armada migración por migración, con unidades CARGADAS ANTES de la migración (como las de una base real) y contra Postgres REAL.
 *
 * Qué fija: (a) lo que ya existía queda con NULL y todo lo demás de la unidad intacto (id, nombre, magnitud, decimales, activa; y la cantidad de filas); (b) el CHECK acepta NULL y cada uno
 * de los 14 códigos y rechaza cualquier otro (minúsculas, espacios, vacío, un código inventado), con 23514; (c) la lista del CHECK es EXACTAMENTE la de `CODIGOS_DE_UNIDAD` (la copia en código
 * de las 14: si una cambia sin la otra, esto falla); (d) sin índice único nuevo (dos unidades pueden ser equivalentes a la misma), sin políticas ni privilegios nuevos; (e) el down.sql ABORTA si
 * alguna unidad ya tiene un código, sin tocar nada; (f) subir, bajar con datos limpios y volver a subir deja la tabla idéntica, y bajar dos veces no falla; (g) concurrencia: dos asignaciones
 * simultáneas a la misma unidad con `WHERE "codigoFijo" IS NULL` dejan UNA sola (la segunda no pisa); (h) aislamiento: asignar el código a la unidad de una empresa no toca la de otra.
 *
 * Mutaciones: borrar el `RAISE` del down.sql rompe (e); sacar un código del CHECK o agregar uno rompe (b) y (c).
 */
const NOMBRE = "20261117130000_unidad_codigo_fijo";
const RAIZ = join(__dirname, "../../prisma/migrations", NOMBRE);
const leer = (archivo: "migration.sql" | "down.sql") => readFileSync(join(RAIZ, archivo), "utf8");
const A = "emp-uni-a";
const B = "emp-uni-b";

let base: BaseTemporalMigrada;
let fotoAntes: unknown;

const q = <T extends object = Record<string, unknown>>(texto: string, params: unknown[] = []) => base.cliente.query<T>(texto, params).then((r) => r.rows);

async function foto() {
  return {
    columnas: await q(`SELECT column_name::text AS columna, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Unidad' ORDER BY ordinal_position`),
    restricciones: await q(`SELECT conname::text AS nombre, pg_get_constraintdef(oid) AS definicion FROM pg_constraint WHERE conrelid = '"Unidad"'::regclass ORDER BY 1`),
    indices: await q(`SELECT indexname::text AS nombre, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'Unidad' ORDER BY 1`),
    politicas: await q(`SELECT policyname::text AS nombre, roles::text AS roles, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public' AND tablename = 'Unidad' ORDER BY 1`),
    privilegios: await q(`SELECT grantee::text AS rol, privilege_type FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'Unidad' ORDER BY 1, 2`),
  };
}

beforeAll(async () => {
  base = await crearBaseTemporalMigrada();
  await base.aplicarAntesDe(NOMBRE);
  for (const e of [A, B]) await base.cliente.query(`INSERT INTO "Empresa" ("id","nombre","slug","zonaHoraria","moneda","estado") VALUES ($1,$1,$1,'America/Argentina/Buenos_Aires','ARS','ACTIVE')`, [e]);
  await base.cliente.query(`INSERT INTO "Unidad" ("id","empresaId","nombre","magnitud","decimales","activa") VALUES
    ('a-kg',$1,'kg','PESO',2,true), ('a-caja',$1,'Caja','CANTIDAD',0,true), ('a-vieja',$1,'Vieja','CANTIDAD',3,false), ('b-kg',$2,'kg','PESO',2,true)`, [A, B]);
  fotoAntes = await foto();
  await base.aplicarRestantes();
}, 180_000);

afterAll(async () => {
  await base?.eliminar();
});

describe("lo que ya existía", () => {
  it("queda con NULL y el resto de la unidad intacto", async () => {
    const filas = await q<{ id: string; nombre: string; magnitud: string; decimales: number; activa: boolean; codigoFijo: string | null }>(`SELECT * FROM "Unidad" WHERE "empresaId" IN ($1,$2) ORDER BY id`, [A, B]);
    expect(filas.map(({ id, nombre, magnitud, decimales, activa, codigoFijo }) => ({ id, nombre, magnitud, decimales, activa, codigoFijo }))).toEqual([
      { id: "a-caja", nombre: "Caja", magnitud: "CANTIDAD", decimales: 0, activa: true, codigoFijo: null },
      { id: "a-kg", nombre: "kg", magnitud: "PESO", decimales: 2, activa: true, codigoFijo: null },
      { id: "a-vieja", nombre: "Vieja", magnitud: "CANTIDAD", decimales: 3, activa: false, codigoFijo: null },
      { id: "b-kg", nombre: "kg", magnitud: "PESO", decimales: 2, activa: true, codigoFijo: null },
    ]);
  });

  it("la columna es TEXT NULL sin valor por defecto y no aparecen índices, políticas ni privilegios nuevos", async () => {
    const despues = (await foto()) as { columnas: Array<{ columna: string; data_type: string; is_nullable: string; column_default: string | null }>; indices: unknown; politicas: unknown; privilegios: unknown };
    const antes = fotoAntes as typeof despues;
    expect(despues.columnas.find((c) => c.columna === "codigoFijo")).toEqual({ columna: "codigoFijo", data_type: "text", is_nullable: "YES", column_default: null });
    expect(despues.columnas.filter((c) => c.columna !== "codigoFijo")).toEqual(antes.columnas);
    expect(despues.indices).toEqual(antes.indices); // sin índice único: dos unidades pueden ser equivalentes a la misma
    expect(despues.politicas).toEqual(antes.politicas);
    expect(despues.privilegios).toEqual(antes.privilegios);
  });
});

describe("el CHECK de las 14", () => {
  it("acepta NULL y cada uno de los 14 códigos", async () => {
    for (const codigo of CODIGOS_DE_UNIDAD) {
      await base.cliente.query(`UPDATE "Unidad" SET "codigoFijo" = $1 WHERE id = 'a-kg'`, [codigo]);
      expect((await q<{ c: string }>(`SELECT "codigoFijo" AS c FROM "Unidad" WHERE id = 'a-kg'`))[0]!.c).toBe(codigo);
    }
    await base.cliente.query(`UPDATE "Unidad" SET "codigoFijo" = NULL WHERE id = 'a-kg'`);
  });

  it.each(["kilogramo", "KILOGRAMO ", " GRAMO", "", "KILO", "CAJA", "Kilogramo", "UNIDAD;"])("rechaza %j con 23514", async (malo) => {
    await expect(base.cliente.query(`UPDATE "Unidad" SET "codigoFijo" = $1 WHERE id = 'a-kg'`, [malo])).rejects.toMatchObject({ code: "23514" });
  });

  it("la lista del CHECK es EXACTAMENTE la de CODIGOS_DE_UNIDAD (la copia en código de las 14)", async () => {
    const def = (await q<{ d: string }>(`SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'Unidad_codigoFijo_chk'`))[0]!.d;
    const delCheck = [...def.matchAll(/'([A-Z_]+)'::text/g)].map((m) => m[1]!).sort();
    expect(delCheck).toEqual([...CODIGOS_DE_UNIDAD].sort());
    expect(delCheck).toHaveLength(14);
  });
});

describe("concurrencia y aislamiento", () => {
  it("dos asignaciones simultáneas a la misma unidad con `WHERE codigoFijo IS NULL`: gana una y la otra no pisa", async () => {
    const { Client } = await import("pg");
    const otro = new Client({ connectionString: base.url });
    await otro.connect();
    try {
      const asignar = (c: { query: (t: string, p: unknown[]) => Promise<{ rowCount: number | null }> }, codigo: string) =>
        c.query(`UPDATE "Unidad" SET "codigoFijo" = $1 WHERE id = 'a-caja' AND "codigoFijo" IS NULL`, [codigo]);
      const [r1, r2] = await Promise.all([asignar(base.cliente, "UNIDAD"), asignar(otro, "GRAMO")]);
      expect((r1.rowCount ?? 0) + (r2.rowCount ?? 0)).toBe(1); // exactamente una escribió
      const final = (await q<{ c: string }>(`SELECT "codigoFijo" AS c FROM "Unidad" WHERE id = 'a-caja'`))[0]!.c;
      expect(["UNIDAD", "GRAMO"]).toContain(final);
      // repetir la misma asignación no cambia nada (idempotente)
      expect((await asignar(base.cliente, final)).rowCount).toBe(0);
    } finally {
      await otro.end();
      await base.cliente.query(`UPDATE "Unidad" SET "codigoFijo" = NULL WHERE id = 'a-caja'`);
    }
  });

  it("asignar el código a la unidad de una empresa no toca la de otra (mismo nombre «kg»)", async () => {
    await base.cliente.query(`UPDATE "Unidad" SET "codigoFijo" = 'KILOGRAMO' WHERE id = 'a-kg'`);
    expect((await q<{ c: string | null }>(`SELECT "codigoFijo" AS c FROM "Unidad" WHERE id = 'b-kg'`))[0]!.c).toBeNull();
    await base.cliente.query(`UPDATE "Unidad" SET "codigoFijo" = NULL WHERE id = 'a-kg'`);
  });
});

describe("down.sql", () => {
  it("ABORTA, sin tocar nada, si alguna unidad ya tiene un código; con datos limpios baja y volver a subir deja la tabla idéntica; bajar dos veces no falla", async () => {
    await base.cliente.query(`UPDATE "Unidad" SET "codigoFijo" = 'KILOGRAMO' WHERE id = 'a-kg'`);
    await expect(base.cliente.query(leer("down.sql"))).rejects.toMatchObject({ code: "55000", message: expect.stringContaining("1 unidad(es)") });
    expect((await q<{ c: string }>(`SELECT "codigoFijo" AS c FROM "Unidad" WHERE id = 'a-kg'`))[0]!.c).toBe("KILOGRAMO"); // sigue ahí

    await base.cliente.query(`UPDATE "Unidad" SET "codigoFijo" = NULL WHERE id = 'a-kg'`);
    const conColumna = await foto();
    await base.cliente.query(leer("down.sql"));
    expect(await foto()).toEqual({ ...fotoAntes as object }); // idéntica a antes de la migración
    await base.cliente.query(leer("down.sql")); // idempotente
    await base.cliente.query(leer("migration.sql"));
    expect(await foto()).toEqual(conColumna); // volver a subir = lo mismo que la primera vez
    expect((await q<{ n: string }>(`SELECT count(*)::text AS n FROM "Unidad" WHERE "empresaId" IN ($1,$2)`, [A, B]))[0]!.n).toBe("4"); // ninguna fila se perdió
  });
});
