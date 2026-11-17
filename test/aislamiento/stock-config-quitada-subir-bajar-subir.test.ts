import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";

/**
 * Quitar sin borrar (migración 20261117180000; frente 3, E-4(2)): `StockMinimoProducto`, `SeccionHabitualProducto` y `FrecuenciaConteoProducto` ganan `quitadoEn` y `quitadoPorId`. SUBIR, BAJAR y SUBIR sobre una base
 * TEMPORAL migrada como una real, con filas ya cargadas. Prueba:
 *  - ANTES: las columnas no existen; SUBIR: existen, las filas viejas quedan IGUALES (sin UPDATE) y vigentes; el CHECK exige las dos marcas juntas (o ninguna) y quién tiene que ser un usuario real (FK);
 *  - la app sigue pudiendo quitar (UPDATE) y los índices únicos de hoy siguen mandando (una fila por clave, quitada o no);
 *  - BAJAR con datos: las filas VIGENTES se conservan intactas y las quitadas se borran (sin la marca volverían a contar); bajar dos veces no falla; SUBIR OTRA VEZ deja el catálogo idéntico al de la primera subida.
 * Contra Postgres local; nunca contra una base real.
 */
const RAIZ = join(__dirname, "../../prisma/migrations");
const MIGRACION = "20261117180000_stock_config_quitada_con_rastro";
const E = "empresa_stock";
const TABLAS = ["StockMinimoProducto", "SeccionHabitualProducto", "FrecuenciaConteoProducto"] as const;

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
const columnas = async () => (await q<{ t: string; c: string }>(`SELECT table_name::text AS t, column_name::text AS c FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ANY($1) AND column_name IN ('quitadoEn','quitadoPorId') ORDER BY 1, 2`, [[...TABLAS]]));
const catalogo = async () => ({
  columnas: await q(`SELECT table_name::text AS t, column_name::text AS c, data_type, is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ANY($1) AND column_name IN ('quitadoEn','quitadoPorId') ORDER BY 1, 2`, [[...TABLAS]]),
  restricciones: await q(`SELECT conrelid::regclass::text AS t, conname::text AS nombre, pg_get_constraintdef(oid) AS definicion FROM pg_constraint WHERE conrelid = ANY($1::regclass[]) AND (conname LIKE '%quitad%') ORDER BY 1, 2`, [TABLAS.map((t) => `public."${t}"`)]),
});
const filas = () =>
  q(`SELECT 'min' AS t, "id", "minimo"::text AS v FROM "StockMinimoProducto" UNION ALL SELECT 'sec', "id", "seccionId" FROM "SeccionHabitualProducto" UNION ALL SELECT 'frec', "id", "frecuenciaDias"::text FROM "FrecuenciaConteoProducto" ORDER BY 1, 2`);

beforeAll(async () => {
  base = await crearBaseTemporalMigrada();
  await base.aplicarAntesDe(MIGRACION);
  await q(`INSERT INTO "Empresa" ("id","nombre","slug","zonaHoraria","moneda","estado") VALUES ($1,$1,$1,'America/Argentina/Buenos_Aires','ARS','ACTIVE')`, [E]);
  await q(`INSERT INTO "Unidad" ("id","empresaId","nombre","magnitud") VALUES ('uni_s',$1,'u','CANTIDAD')`, [E]);
  await q(`INSERT INTO "Producto" ("id","empresaId","codigo","nombre","tipo","unidadStockId","precioVenta") VALUES ('prod_s1',$1,'PV_1','Milanesa','PV','uni_s',8000), ('prod_s2',$1,'PV_2','Flan','PV','uni_s',3000)`, [E]);
  await q(`INSERT INTO "Sucursal" ("id","empresaId","nombre") VALUES ('suc_s',$1,'Centro')`, [E]);
  await q(`INSERT INTO "Seccion" ("id","empresaId","sucursalId","nombre") VALUES ('sec_s',$1,'suc_s','Barra')`, [E]);
  await q(`INSERT INTO "User" ("id","email") VALUES ('u_s','s@ejemplo.test')`);
  await q(`INSERT INTO "StockMinimoProducto" ("id","empresaId","sucursalId","productoId","seccionId","minimo") VALUES ('min1',$1,'suc_s','prod_s1',NULL,5), ('min2',$1,'suc_s','prod_s2','sec_s',2.5)`, [E]);
  await q(`INSERT INTO "SeccionHabitualProducto" ("id","empresaId","sucursalId","productoId","seccionId") VALUES ('hab1',$1,'suc_s','prod_s1','sec_s'), ('hab2',$1,'suc_s','prod_s2','sec_s')`, [E]);
  await q(`INSERT INTO "FrecuenciaConteoProducto" ("id","empresaId","sucursalId","productoId","frecuenciaDias") VALUES ('fre1',$1,'suc_s','prod_s1',7), ('fre2',$1,'suc_s','prod_s2',3)`, [E]);
}, 300_000);

afterAll(async () => {
  await base?.eliminar();
});

describe("Stock: quitar sin borrar (subir, bajar y subir, con filas cargadas)", () => {
  let antes: Awaited<ReturnType<typeof filas>>;
  let primera: Awaited<ReturnType<typeof catalogo>>;

  it("ANTES: no existen las columnas", async () => {
    expect(await columnas()).toEqual([]);
    antes = await filas();
    expect(antes).toHaveLength(6);
  });

  it("SUBIR: seis columnas nuevas, las filas viejas iguales y vigentes; el CHECK exige las dos marcas juntas y quién tiene que existir", async () => {
    await correr("migration.sql");
    expect((await columnas()).map((x) => `${x.t}.${x.c}`)).toEqual(TABLAS.flatMap((t) => [`${t}.quitadoEn`, `${t}.quitadoPorId`]).sort());
    expect(await filas()).toEqual(antes);
    expect(await q(`SELECT count(*)::int AS n FROM "StockMinimoProducto" WHERE "quitadoEn" IS NULL AND "quitadoPorId" IS NULL`)).toEqual([{ n: 2 }]);
    for (const t of TABLAS) {
      const id = { StockMinimoProducto: "min1", SeccionHabitualProducto: "hab1", FrecuenciaConteoProducto: "fre1" }[t];
      expect(await falla(`UPDATE "${t}" SET "quitadoEn" = now() WHERE "id" = '${id}'`), `${t}: solo quitadoEn`).toBe("23514");
      expect(await falla(`UPDATE "${t}" SET "quitadoPorId" = 'u_s' WHERE "id" = '${id}'`), `${t}: solo quitadoPorId`).toBe("23514");
      expect(await falla(`UPDATE "${t}" SET "quitadoEn" = now(), "quitadoPorId" = 'no_existe' WHERE "id" = '${id}'`), `${t}: usuario inexistente`).toBe("23503");
      expect(await falla(`UPDATE "${t}" SET "quitadoEn" = now(), "quitadoPorId" = 'u_s' WHERE "id" = '${id}'`), `${t}: quitar bien`).toBe("sin error");
    }
    primera = await catalogo();
    expect(primera.restricciones).toHaveLength(6);
  });

  it("la clave única de hoy sigue mandando: una fila por clave, quitada o no (la app reactiva en su lugar)", async () => {
    await q(`UPDATE "FrecuenciaConteoProducto" SET "quitadoEn" = now(), "quitadoPorId" = 'u_s' WHERE "id" = 'fre1'`);
    expect(await falla(`INSERT INTO "FrecuenciaConteoProducto" ("id","empresaId","sucursalId","productoId","frecuenciaDias") VALUES ('fre_dup',$1,'suc_s','prod_s1',9)`, [E])).toBe("23505");
    await q(`UPDATE "FrecuenciaConteoProducto" SET "frecuenciaDias" = 9, "quitadoEn" = NULL, "quitadoPorId" = NULL WHERE "id" = 'fre1'`);
    expect(await q(`SELECT "frecuenciaDias", "quitadoEn" FROM "FrecuenciaConteoProducto" WHERE "id" = 'fre1'`)).toEqual([{ frecuenciaDias: 9, quitadoEn: null }]);
    await q(`UPDATE "FrecuenciaConteoProducto" SET "frecuenciaDias" = 7 WHERE "id" = 'fre1'`);
  });

  it("BAJAR con datos: las quitadas se borran, las vigentes quedan iguales; bajar dos veces no falla", async () => {
    await q(`UPDATE "StockMinimoProducto" SET "quitadoEn" = now(), "quitadoPorId" = 'u_s' WHERE "id" = 'min2'`);
    // Estado antes de bajar: min1 y fre1 vigentes (hab1 también: la quita de la prueba del CHECK se revirtió); se quitan min2, hab2 y fre2.
    await q(`UPDATE "SeccionHabitualProducto" SET "quitadoEn" = now(), "quitadoPorId" = 'u_s' WHERE "id" = 'hab2'`);
    await q(`UPDATE "FrecuenciaConteoProducto" SET "quitadoEn" = now(), "quitadoPorId" = 'u_s' WHERE "id" = 'fre2'`);
    await correr("down.sql");
    expect(await columnas()).toEqual([]);
    expect((await filas()).map((f) => f.id)).toEqual(["fre1", "min1", "hab1"]);
    expect(await filas()).toEqual(antes.filter((f) => ["fre1", "min1", "hab1"].includes(f.id as string)));
    await correr("down.sql");
    expect(await columnas()).toEqual([]);
  });

  it("SUBIR OTRA VEZ: el catálogo queda idéntico al de la primera subida y las filas vigentes siguen", async () => {
    await correr("migration.sql");
    expect(await catalogo()).toEqual(primera);
    expect((await filas()).map((f) => f.id)).toEqual(["fre1", "min1", "hab1"]);
  });
});
