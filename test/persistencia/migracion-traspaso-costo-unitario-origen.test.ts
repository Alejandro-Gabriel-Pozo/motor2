import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";

/**
 * E2 «el costo viaja con el traspaso» (ADR-040, docs/diseno-costo-en-el-traspaso-2026-10-27.md) — migración 20261027120000_traspaso_costo_unitario_origen: `TraspasoSucursal.costoUnitarioOrigen`,
 * DECIMAL(14,4) NULL con CHECK (nunca negativa). SUBIR, BAJAR y SUBIR sobre una base TEMPORAL descartable (`crearBaseTemporalMigrada`: solo Postgres local, jamás una base real), con un traspaso CARGADO ANTES.
 *
 * Qué fija: (0) la migración existe, avisa que requiere autorización y tiene down.sql; (a) al subir, el traspaso viejo queda con el costo en NULL (sin relleno) y lo demás intacto; la columna es numeric(14,4)
 * nulable, sin default, al final de la tabla; (b) el CHECK: un costo negativo da 23514, 0 y un costo con 4 decimales pasan, y la copia se guarda EXACTA; (c) motor2_app tiene sobre la columna lo mismo que sobre la tabla (privilegios
 * de tabla) y no hay políticas ni privilegios nuevos; (d) el down.sql ABORTA si hay un costo copiado, sin tocar nada; (e) sin costos, bajar deja el catálogo IDÉNTICO al de antes, bajar dos veces no falla y
 * subir otra vez deja el catálogo idéntico al de la primera subida.
 *
 * Mutaciones: sacar el CHECK rompe (b); un default 0 en la columna rompe (a) (el traspaso viejo quedaría con 0 inventado); sacar la guarda del down.sql rompe (d).
 */
const NOMBRE = "20261027120000_traspaso_costo_unitario_origen";
const RAIZ = join(__dirname, "../../prisma/migrations");
const sql = (archivo: "migration.sql" | "down.sql") => readFileSync(join(RAIZ, NOMBRE, archivo), "utf8");
const E = "emp-costo-traspaso";

let base: BaseTemporalMigrada;
let hayRol = false;

const correr = (archivo: "migration.sql" | "down.sql") => base.cliente.query(sql(archivo));
const q = <T extends object = Record<string, unknown>>(texto: string, params: unknown[] = []) => base.cliente.query<T>(texto, params).then((r) => r.rows);

async function foto() {
  return {
    columnas: await q(`SELECT column_name::text AS columna, data_type, numeric_precision, numeric_scale, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'TraspasoSucursal' ORDER BY ordinal_position`),
    restricciones: await q(`SELECT conname::text AS nombre, convalidated, pg_get_constraintdef(oid) AS definicion FROM pg_constraint WHERE conrelid = '"TraspasoSucursal"'::regclass ORDER BY 1`),
    indices: await q(`SELECT indexname::text AS nombre, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'TraspasoSucursal' ORDER BY 1`),
    politicas: await q(`SELECT policyname::text AS nombre, permissive, roles::text AS roles, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public' AND tablename = 'TraspasoSucursal' ORDER BY 1`),
    privilegios: await q(`SELECT grantee::text AS rol, privilege_type FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'TraspasoSucursal' AND grantee IN ('motor2_app', 'motor2_plataforma') ORDER BY 1, 2`),
    privilegiosPorColumna: await q(`SELECT grantee::text AS rol, column_name::text AS columna, privilege_type FROM information_schema.column_privileges WHERE table_schema = 'public' AND table_name = 'TraspasoSucursal' AND grantee IN ('motor2_app', 'motor2_plataforma') AND column_name <> 'costoUnitarioOrigen' ORDER BY 1, 2, 3`),
  };
}

/** El traspaso viejo SIN la columna nueva: subir y bajar no lo tocan. */
const traspasoViejo = async () => (await q(`SELECT id, "empresaId", "origenSucursalId", "destinoSucursalId", "productoId", cantidad, estado, "seccionOrigenId", "seccionDestinoId" FROM "TraspasoSucursal" WHERE id = 'tr_viejo'`))[0];

let antes: Awaited<ReturnType<typeof foto>>;
let filaAntes: unknown;
let arribaLaPrimeraVez: Awaited<ReturnType<typeof foto>>;

beforeAll(async () => {
  base = await crearBaseTemporalMigrada();
  hayRol = (await base.cliente.query("SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app'")).rowCount === 1;
  await base.aplicarAntesDe(NOMBRE);
  const c = base.cliente;
  await c.query(`INSERT INTO "Empresa" ("id","nombre","slug","zonaHoraria","moneda","estado") VALUES ($1,$1,$1,'America/Argentina/Buenos_Aires','ARS','ACTIVE')`, [E]);
  await c.query(`INSERT INTO "Sucursal" ("id","empresaId","nombre") VALUES ('suc_a',$1,'Centro'), ('suc_b',$1,'Norte')`, [E]);
  await c.query(`INSERT INTO "User" ("id","email") VALUES ('u_e2','e2@ejemplo.test')`);
  await c.query(`INSERT INTO "Unidad" ("id","empresaId","nombre","magnitud") VALUES ('kg',$1,'kg','PESO')`, [E]);
  await c.query(`INSERT INTO "Producto" ("id","empresaId","codigo","nombre","tipo","unidadStockId") VALUES ('harina',$1,'MP_H','Harina','MP','kg')`, [E]);
  await c.query(
    `INSERT INTO "TraspasoSucursal" ("id","empresaId","origenSucursalId","destinoSucursalId","productoId","cantidad","iniciadoPor","estado","creadoPorId") VALUES ('tr_viejo',$1,'suc_a','suc_b','harina',3.5,'ORIGEN','ENVIADA','u_e2')`,
    [E]
  );
  antes = await foto();
  filaAntes = await traspasoViejo();
}, 120_000);

afterAll(async () => {
  await base?.eliminar();
}, 60_000);

describe("E2: costo unitario de origen en el traspaso (migración 20261027120000)", () => {
  it("(0) la migración existe, es posterior a M1 del mostrador, avisa que requiere autorización y tiene down.sql", () => {
    const carpetas = readdirSync(RAIZ, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
    expect(carpetas).toContain(NOMBRE);
    expect(NOMBRE > "20261027100000_m1_puesto_mostrador").toBe(true);
    expect(sql("migration.sql")).toContain("REQUIERE AUTORIZACIÓN EXPRESA");
    expect(sql("down.sql").length).toBeGreaterThan(0);
  });

  it("(a) al subir, el traspaso viejo queda con el costo en NULL (sin relleno) y lo demás intacto; la columna es numeric(14,4) nulable, sin default, al final", async () => {
    await correr("migration.sql");
    expect(await traspasoViejo()).toEqual(filaAntes);
    expect((await q(`SELECT "costoUnitarioOrigen" FROM "TraspasoSucursal" WHERE id = 'tr_viejo'`))[0]).toEqual({ costoUnitarioOrigen: null });
    const columnas = (await foto()).columnas as { columna: string }[];
    expect(columnas.at(-1)).toEqual({ columna: "costoUnitarioOrigen", data_type: "numeric", numeric_precision: 14, numeric_scale: 4, is_nullable: "YES", column_default: null });
    arribaLaPrimeraVez = await foto();
  });

  it("(b) el CHECK: negativo da 23514; 0 y un costo con 4 decimales pasan, y la copia se guarda exacta", async () => {
    await expect(base.cliente.query(`UPDATE "TraspasoSucursal" SET "costoUnitarioOrigen" = -0.0001 WHERE id = 'tr_viejo'`)).rejects.toMatchObject({
      code: "23514",
      constraint: "TraspasoSucursal_costo_unitario_origen_no_negativo_chk",
    });
    for (const valor of ["0.0000", "100.0400", "1234567890.1234"]) {
      await base.cliente.query(`UPDATE "TraspasoSucursal" SET "costoUnitarioOrigen" = $1 WHERE id = 'tr_viejo'`, [valor]);
      expect((await q<{ c: string }>(`SELECT "costoUnitarioOrigen"::text AS c FROM "TraspasoSucursal" WHERE id = 'tr_viejo'`))[0].c).toBe(valor);
    }
    await base.cliente.query(`UPDATE "TraspasoSucursal" SET "costoUnitarioOrigen" = NULL WHERE id = 'tr_viejo'`);
  });

  it("(c) motor2_app tiene sobre la columna lo mismo que sobre la tabla (sin privilegios por columna); sin políticas, índices ni privilegios nuevos", async (ctx) => {
    const sinLaColumna = (f: Awaited<ReturnType<typeof foto>>) => ({
      ...f,
      columnas: (f.columnas as { columna: string }[]).filter((c) => c.columna !== "costoUnitarioOrigen"),
      restricciones: (f.restricciones as { nombre: string }[]).filter((r) => r.nombre !== "TraspasoSucursal_costo_unitario_origen_no_negativo_chk"),
    });
    expect(sinLaColumna(await foto())).toEqual(antes);
    if (!hayRol) return ctx.skip();
    // Sin privilegios por columna: lo que `motor2_app` puede hacer con la columna nueva es exactamente lo que puede hacer con la tabla (en las bases reales, SELECT, INSERT y UPDATE).
    for (const privilegio of ["SELECT", "INSERT", "UPDATE"]) {
      const [fila] = await q<{ columna: boolean; tabla: boolean }>(
        `SELECT has_column_privilege('motor2_app', '"TraspasoSucursal"', 'costoUnitarioOrigen', $1) AS columna, has_table_privilege('motor2_app', '"TraspasoSucursal"', $1) AS tabla`,
        [privilegio]
      );
      expect(fila.columna, privilegio).toBe(fila.tabla);
    }
  });

  it("(d) con un costo copiado, el down.sql ABORTA sin tocar nada", async () => {
    await base.cliente.query(`UPDATE "TraspasoSucursal" SET "costoUnitarioOrigen" = 120 WHERE id = 'tr_viejo'`);
    await expect(correr("down.sql")).rejects.toThrow(/No se puede bajar 20261027120000_traspaso_costo_unitario_origen: hay 1 traspaso\(s\) con el costo del origen copiado/);
    expect(await foto()).toEqual(arribaLaPrimeraVez);
    expect((await q(`SELECT "costoUnitarioOrigen"::text AS c FROM "TraspasoSucursal" WHERE id = 'tr_viejo'`))[0]).toEqual({ c: "120.0000" });
    await base.cliente.query(`UPDATE "TraspasoSucursal" SET "costoUnitarioOrigen" = NULL WHERE id = 'tr_viejo'`);
  });

  it("(e) sin costos: bajar deja el catálogo idéntico al de antes, bajar dos veces no falla, y subir otra vez deja el de la primera subida", async () => {
    await correr("down.sql");
    expect(await foto()).toEqual(antes);
    expect(await traspasoViejo()).toEqual(filaAntes);
    await correr("down.sql");
    expect(await foto()).toEqual(antes);
    await correr("migration.sql");
    expect(await foto()).toEqual(arribaLaPrimeraVez);
    expect(await traspasoViejo()).toEqual(filaAntes);
  });
});
