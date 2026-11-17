import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USOS_DE_SECCION } from "@/core/compras/public";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";

/**
 * Compras, depósitos de uso RECHAZO y CUARENTENA, etapa (i) (2026-11-17) — migración 20261117126000_compras_uso_de_seccion: `Seccion.uso` (TEXT NOT NULL DEFAULT 'NORMAL') con el CHECK `Seccion_uso_chk` y el disparador de inmutabilidad
 * `Seccion_uso_inmutable_chk`. Sobre una base temporal armada migración por migración, con secciones CARGADAS ANTES de la migración (como las de una base real) y contra Postgres REAL.
 *
 * Qué fija: (a) las secciones que ya existían quedan NORMAL y todo lo demás intacto (id, nombre, activa, respaldo y la cantidad de filas); (b) el CHECK acepta cada uno de los tres usos y rechaza cualquier otro (minúsculas, espacios, vacío, NULL,
 * un uso inventado), con 23514 / 23502; (c) la lista del CHECK es EXACTAMENTE la de `USOS_DE_SECCION`; (d) el uso es INMUTABLE: un UPDATE que lo cambia falla con 23514 (también NORMAL → RECHAZO y RECHAZO → NORMAL), uno que lo deja igual pasa, y
 * renombrar o desactivar la sección no lo toca; (e) sin índice único por sucursal (puede haber varias del mismo uso), sin políticas ni privilegios nuevos; (f) el down.sql ABORTA, sin tocar nada, si alguna sección tiene un uso distinto de
 * NORMAL, y con todas NORMAL baja limpio (la tabla queda idéntica a antes), se puede bajar dos veces y volver a subir; (g) concurrencia: dos cambios de uso simultáneos sobre la misma sección fallan los dos; (h) aislamiento: la sección de otra
 * empresa con el mismo nombre no se toca.
 *
 * Mutaciones: borrar el disparador rompe (d); borrar el `RAISE` del down.sql rompe (f); sacar o agregar un uso del CHECK rompe (b) y (c).
 */
const NOMBRE = "20261117126000_compras_uso_de_seccion";
const RAIZ = join(__dirname, "../../prisma/migrations", NOMBRE);
const leer = (archivo: "migration.sql" | "down.sql") => readFileSync(join(RAIZ, archivo), "utf8");
const A = "emp-uso-a";
const B = "emp-uso-b";

let base: BaseTemporalMigrada;
let fotoAntes: unknown;

const q = <T extends object = Record<string, unknown>>(texto: string, params: unknown[] = []) => base.cliente.query<T>(texto, params).then((r) => r.rows);

async function foto() {
  return {
    columnas: await q(`SELECT column_name::text AS columna, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Seccion' ORDER BY ordinal_position`),
    restricciones: await q(`SELECT conname::text AS nombre, pg_get_constraintdef(oid) AS definicion FROM pg_constraint WHERE conrelid = '"Seccion"'::regclass ORDER BY 1`),
    indices: await q(`SELECT indexname::text AS nombre, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'Seccion' ORDER BY 1`),
    politicas: await q(`SELECT policyname::text AS nombre, roles::text AS roles, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public' AND tablename = 'Seccion' ORDER BY 1`),
    privilegios: await q(`SELECT grantee::text AS rol, privilege_type FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'Seccion' ORDER BY 1, 2`),
    disparadores: await q(`SELECT tgname::text AS nombre FROM pg_trigger WHERE tgrelid = '"Seccion"'::regclass AND NOT tgisinternal ORDER BY 1`),
  };
}

beforeAll(async () => {
  base = await crearBaseTemporalMigrada();
  await base.aplicarAntesDe(NOMBRE);
  for (const e of [A, B]) await base.cliente.query(`INSERT INTO "Empresa" ("id","nombre","slug","zonaHoraria","moneda","estado") VALUES ($1,$1,$1,'America/Argentina/Buenos_Aires','ARS','ACTIVE')`, [e]);
  await base.cliente.query(`INSERT INTO "Sucursal" ("id","empresaId","nombre") VALUES ('suc-a',$1,'Centro'), ('suc-b',$2,'Centro')`, [A, B]);
  await base.cliente.query(`INSERT INTO "Seccion" ("id","empresaId","sucursalId","nombre","activa","sirveDeRespaldoEnVentas") VALUES
    ('a-dep','${A}','suc-a','Depósito',true,true), ('a-vieja','${A}','suc-a','Vieja',false,false), ('b-dep','${B}','suc-b','Depósito',true,true)`);
  fotoAntes = await foto();
  await base.aplicarRestantes();
}, 180_000);

afterAll(async () => {
  await base?.eliminar();
});

describe("lo que ya existía", () => {
  it("queda NORMAL y el resto de la sección intacto", async () => {
    const filas = await q<{ id: string; nombre: string; activa: boolean; sirveDeRespaldoEnVentas: boolean; uso: string }>(`SELECT * FROM "Seccion" ORDER BY id`);
    expect(filas.map(({ id, nombre, activa, sirveDeRespaldoEnVentas, uso }) => ({ id, nombre, activa, sirveDeRespaldoEnVentas, uso }))).toEqual([
      { id: "a-dep", nombre: "Depósito", activa: true, sirveDeRespaldoEnVentas: true, uso: "NORMAL" },
      { id: "a-vieja", nombre: "Vieja", activa: false, sirveDeRespaldoEnVentas: false, uso: "NORMAL" },
      { id: "b-dep", nombre: "Depósito", activa: true, sirveDeRespaldoEnVentas: true, uso: "NORMAL" },
    ]);
  });

  it("la columna es TEXT NOT NULL con default NORMAL; sin índices, políticas ni privilegios nuevos; solo se suman el CHECK y el disparador", async () => {
    type Foto = { columnas: Array<{ columna: string }>; restricciones: Array<{ nombre: string }>; indices: unknown; politicas: unknown; privilegios: unknown; disparadores: Array<{ nombre: string }> };
    const despues = (await foto()) as unknown as Foto;
    const antes = fotoAntes as Foto;
    expect(despues.columnas.find((c) => c.columna === "uso")).toEqual({ columna: "uso", data_type: "text", is_nullable: "NO", column_default: "'NORMAL'::text" });
    expect(despues.columnas.filter((c) => c.columna !== "uso")).toEqual(antes.columnas);
    expect(despues.indices).toEqual(antes.indices); // sin índice único por sucursal: puede haber varias del mismo uso
    expect(despues.politicas).toEqual(antes.politicas);
    expect(despues.privilegios).toEqual(antes.privilegios);
    expect(despues.restricciones.map((r) => r.nombre).filter((n) => !antes.restricciones.some((a) => a.nombre === n))).toEqual(["Seccion_uso_chk"]);
    expect(despues.disparadores.map((d) => d.nombre).filter((n) => !antes.disparadores.some((a) => a.nombre === n))).toEqual(["Seccion_uso_inmutable_chk"]);
  });
});

describe("el CHECK de los tres usos", () => {
  it("una sección nueva nace NORMAL si no dice nada, y acepta cada uno de los tres usos al crearse", async () => {
    await base.cliente.query(`INSERT INTO "Seccion" ("id","empresaId","sucursalId","nombre") VALUES ('a-sin-uso','${A}','suc-a','Sin uso')`);
    expect((await q<{ uso: string }>(`SELECT uso FROM "Seccion" WHERE id = 'a-sin-uso'`))[0]!.uso).toBe("NORMAL");
    for (const uso of USOS_DE_SECCION) {
      await base.cliente.query(`INSERT INTO "Seccion" ("id","empresaId","sucursalId","nombre","uso") VALUES ($1,'${A}','suc-a',$2,$3)`, [`a-${uso}`, `Uso ${uso}`, uso]);
      expect((await q<{ uso: string }>(`SELECT uso FROM "Seccion" WHERE id = $1`, [`a-${uso}`]))[0]!.uso).toBe(uso);
    }
  });

  it("puede haber VARIAS del mismo uso en la misma sucursal (sin unicidad por sucursal)", async () => {
    await base.cliente.query(`INSERT INTO "Seccion" ("id","empresaId","sucursalId","nombre","uso") VALUES ('a-rechazo-2','${A}','suc-a','Otro rechazo','RECHAZO')`);
    expect((await q<{ n: string }>(`SELECT count(*)::text AS n FROM "Seccion" WHERE "sucursalId" = 'suc-a' AND uso = 'RECHAZO'`))[0]!.n).toBe("2");
  });

  it.each(["rechazo", "RECHAZO ", " NORMAL", "", "DEVOLUCION", "CALIDAD", "Normal", "NORMAL;"])("rechaza el uso %j al crear con 23514", async (malo) => {
    await expect(base.cliente.query(`INSERT INTO "Seccion" ("id","empresaId","sucursalId","nombre","uso") VALUES ('a-malo','${A}','suc-a','Malo',$1)`, [malo])).rejects.toMatchObject({ code: "23514" });
  });

  it("rechaza NULL (23502)", async () => {
    await expect(base.cliente.query(`INSERT INTO "Seccion" ("id","empresaId","sucursalId","nombre","uso") VALUES ('a-nulo','${A}','suc-a','Nulo',NULL)`)).rejects.toMatchObject({ code: "23502" });
  });

  it("la lista del CHECK es EXACTAMENTE la de USOS_DE_SECCION", async () => {
    const def = (await q<{ d: string }>(`SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'Seccion_uso_chk'`))[0]!.d;
    expect([...def.matchAll(/'([A-Z_]+)'::text/g)].map((m) => m[1]!).sort()).toEqual([...USOS_DE_SECCION].sort());
  });
});

describe("el uso es inmutable", () => {
  it.each([["a-dep", "RECHAZO"], ["a-dep", "CUARENTENA"], ["a-RECHAZO", "NORMAL"], ["a-RECHAZO", "CUARENTENA"], ["a-CUARENTENA", "RECHAZO"]])("UPDATE de %s a %s falla con 23514 y no cambia nada", async (id, uso) => {
    const antes = (await q<{ uso: string }>(`SELECT uso FROM "Seccion" WHERE id = $1`, [id]))[0]!.uso;
    await expect(base.cliente.query(`UPDATE "Seccion" SET "uso" = $1 WHERE id = $2`, [uso, id])).rejects.toMatchObject({ code: "23514", message: expect.stringContaining("no se cambia") });
    expect((await q<{ uso: string }>(`SELECT uso FROM "Seccion" WHERE id = $1`, [id]))[0]!.uso).toBe(antes);
  });

  it("un UPDATE que deja el uso igual pasa; renombrar o desactivar no lo toca", async () => {
    await base.cliente.query(`UPDATE "Seccion" SET "uso" = 'RECHAZO' WHERE id = 'a-RECHAZO'`);
    await base.cliente.query(`UPDATE "Seccion" SET "nombre" = 'Rechazo renombrado', "activa" = false WHERE id = 'a-RECHAZO'`);
    expect((await q<{ uso: string; nombre: string; activa: boolean }>(`SELECT uso, nombre, activa FROM "Seccion" WHERE id = 'a-RECHAZO'`))[0]).toEqual({ uso: "RECHAZO", nombre: "Rechazo renombrado", activa: false });
    await base.cliente.query(`UPDATE "Seccion" SET "nombre" = 'Uso RECHAZO', "activa" = true WHERE id = 'a-RECHAZO'`);
  });

  it("concurrencia: dos cambios de uso simultáneos sobre la misma sección fallan los dos y el uso sigue siendo el de origen", async () => {
    const { Client } = await import("pg");
    const otro = new Client({ connectionString: base.url });
    await otro.connect();
    try {
      const cambiar = (c: { query: (t: string, p: unknown[]) => Promise<unknown> }, uso: string) => c.query(`UPDATE "Seccion" SET "uso" = $1 WHERE id = 'a-dep'`, [uso]);
      const resultados = await Promise.allSettled([cambiar(base.cliente, "RECHAZO"), cambiar(otro, "CUARENTENA")]);
      expect(resultados.map((r) => r.status)).toEqual(["rejected", "rejected"]);
      expect((await q<{ uso: string }>(`SELECT uso FROM "Seccion" WHERE id = 'a-dep'`))[0]!.uso).toBe("NORMAL");
    } finally {
      await otro.end();
    }
  });
});

describe("aislamiento", () => {
  it("las secciones de otra empresa (mismo nombre) no se tocan al crear o al intentar cambiar", async () => {
    await expect(base.cliente.query(`UPDATE "Seccion" SET "uso" = 'RECHAZO' WHERE "empresaId" = '${A}' AND nombre = 'Depósito'`)).rejects.toMatchObject({ code: "23514" });
    expect((await q<{ uso: string }>(`SELECT uso FROM "Seccion" WHERE id = 'b-dep'`))[0]!.uso).toBe("NORMAL");
  });
});

describe("down.sql", () => {
  it("ABORTA, sin tocar nada, si alguna sección tiene un uso distinto de NORMAL; con todas NORMAL baja limpio (idéntica a antes), bajar dos veces no falla y volver a subir deja lo mismo", async () => {
    await expect(base.cliente.query(leer("down.sql"))).rejects.toMatchObject({ code: "55000", message: expect.stringMatching(/hay \d+ depósito\(s\) con un uso distinto de NORMAL/) });
    expect((await q<{ n: string }>(`SELECT count(*)::text AS n FROM "Seccion" WHERE uso <> 'NORMAL'`))[0]!.n).not.toBe("0"); // siguen ahí
    expect((await foto() as { disparadores: unknown[] }).disparadores.length).toBeGreaterThan(0); // el disparador sigue puesto

    await base.cliente.query(`DELETE FROM "Seccion" WHERE id NOT IN ('a-dep','a-vieja','b-dep')`);
    const conColumna = await foto();
    await base.cliente.query(leer("down.sql"));
    expect(await foto()).toEqual(fotoAntes); // idéntica a antes de la migración
    await base.cliente.query(leer("down.sql")); // idempotente
    await base.cliente.query(leer("migration.sql"));
    expect(await foto()).toEqual(conColumna); // volver a subir = lo mismo que la primera vez
    expect((await q<{ n: string }>(`SELECT count(*)::text AS n FROM "Seccion" WHERE uso = 'NORMAL'`))[0]!.n).toBe("3"); // ninguna fila se perdió; todas NORMAL
  });
});
