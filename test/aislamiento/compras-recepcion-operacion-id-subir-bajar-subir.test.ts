import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";

/**
 * Compras, recepción separada N3-a: SUBIR, BAJAR y SUBIR de la migración real `20261117120000_compras_recepcion_operacion_id` sobre una base TEMPORAL descartable (`crearBaseTemporalMigrada`: solo Postgres local, jamás una base
 * real), con su `down.sql` tal cual está en el repo. La aplicación a bases reales NO sale de esta rama: la hace la coordinación con respaldo y ensayo.
 *
 * Qué comprueba:
 *  0. La migración existe, avisa que requiere autorización y tiene down.sql y verificacion-previa.sql.
 *  1. SUBIR: `motor2_app` gana UPDATE de la columna `operacionId` de `FacturaProveedorSucursal` y NADA MÁS cambia: ni otro privilegio de columna ni de tabla, ni las políticas de RLS, ni los índices (la unicidad
 *     (empresaId, operacionId) sigue), ni las restricciones, ni las columnas, ni el RLS de ninguna tabla.
 *  2. BAJAR deja el catálogo IDÉNTICO al de antes de la migración (con los datos de la parte intactos).
 *  3. BAJAR DOS VECES no falla; SUBIR OTRA VEZ deja el catálogo idéntico al de la primera subida.
 *
 * Mutación (anotada en el commit): dar UPDATE de tabla en vez de por columna → rojo el caso 1; sacar el REVOKE del down.sql → rojo el caso 2.
 */
const RAIZ = join(__dirname, "../../prisma/migrations");
const MIGRACION = "20261117120000_compras_recepcion_operacion_id";
const sql = (archivo: "migration.sql" | "down.sql") => readFileSync(join(RAIZ, MIGRACION, archivo), "utf8");

let base: BaseTemporalMigrada;
const q = <T extends object = Record<string, unknown>>(texto: string, params: unknown[] = []) => base.cliente.query<T>(texto, params).then((r) => r.rows);

async function foto() {
  return {
    tablas: await q(`SELECT relname::text AS tabla, relrowsecurity AS rls, relforcerowsecurity AS forzado FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' ORDER BY 1`),
    columnas: await q(`SELECT table_name::text AS tabla, column_name::text AS columna, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' ORDER BY 1, ordinal_position`),
    indices: await q(`SELECT tablename::text AS tabla, indexname::text AS nombre, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY 1, 2`),
    restricciones: await q(`SELECT conrelid::regclass::text AS tabla, conname::text AS nombre, contype, convalidated, pg_get_constraintdef(oid) AS definicion FROM pg_constraint WHERE connamespace = 'public'::regnamespace ORDER BY 1, 2`),
    politicas: await q(`SELECT tablename::text AS tabla, policyname::text AS nombre, permissive, roles::text AS roles, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public' ORDER BY 1, 2`),
    disparadores: await q(`SELECT tgrelid::regclass::text AS tabla, tgname::text AS nombre, pg_get_triggerdef(oid) AS definicion FROM pg_trigger WHERE NOT tgisinternal ORDER BY 1, 2`),
    privilegios: await q(`SELECT table_name::text AS tabla, grantee::text AS rol, privilege_type FROM information_schema.role_table_grants WHERE table_schema = 'public' AND grantee IN ('motor2_app', 'motor2_plataforma') ORDER BY 1, 2, 3`),
    privilegiosPorColumna: await q(`SELECT table_name::text AS tabla, column_name::text AS columna, grantee::text AS rol, privilege_type FROM information_schema.column_privileges WHERE table_schema = 'public' AND grantee IN ('motor2_app', 'motor2_plataforma') ORDER BY 1, 2, 3, 4`),
  };
}
type Foto = Awaited<ReturnType<typeof foto>>;
const hayRol = async (rol: string) => (await q<{ n: string }>(`SELECT count(*)::text AS n FROM pg_roles WHERE rolname = $1`, [rol]))[0]!.n === "1";
const correr = (archivo: "migration.sql" | "down.sql") => base.cliente.query(sql(archivo));
const esLaColumna = (f: Record<string, unknown>) => f.tabla === "FacturaProveedorSucursal" && f.columna === "operacionId" && f.privilege_type === "UPDATE";

let antes: Foto;
let arriba: Foto;

beforeAll(async () => {
  base = await crearBaseTemporalMigrada();
  await base.aplicarAntesDe(MIGRACION);
  antes = await foto();
}, 180_000);

afterAll(async () => {
  await base?.eliminar();
}, 60_000);

describe("Compras N3-a: subir, bajar y subir sobre una base temporal con todo lo anterior aplicado", () => {
  it("0. la migración existe, avisa la autorización y tiene down.sql y verificacion-previa.sql", () => {
    expect(readdirSync(RAIZ)).toContain(MIGRACION);
    expect(sql("migration.sql").split("\n")[0]).toContain("REQUIERE AUTORIZACIÓN EXPRESA");
    expect(sql("down.sql").length).toBeGreaterThan(0);
    expect(readdirSync(join(RAIZ, MIGRACION)).sort()).toEqual(["down.sql", "migration.sql", "verificacion-previa.sql"]);
  });

  it("1. SUBIR: UPDATE de operacionId para la app y NADA más cambia (privilegios, políticas, índices, restricciones, columnas, RLS, disparadores)", async () => {
    await correr("migration.sql");
    const f = await foto();
    // Todo el catálogo menos los privilegios por columna es idéntico.
    const { privilegiosPorColumna: columnasDespues, ...restoDespues } = f;
    const { privilegiosPorColumna: columnasAntes, ...restoAntes } = antes;
    expect(restoDespues).toEqual(restoAntes);
    if (await hayRol("motor2_app")) {
      // Los privilegios por columna: la ÚNICA diferencia es el UPDATE de operacionId de la app.
      expect(columnasAntes.some(esLaColumna), "antes de la migración la app no podía actualizar operacionId").toBe(false);
      expect(columnasDespues.filter(esLaColumna)).toEqual([{ tabla: "FacturaProveedorSucursal", columna: "operacionId", rol: "motor2_app", privilege_type: "UPDATE" }]);
      expect(columnasDespues.filter((c) => !esLaColumna(c))).toEqual(columnasAntes);
      // Las columnas de la parte que la app puede actualizar: las tres de la recepción y la compra; ninguna otra.
      const updates = columnasDespues.filter((c) => c.tabla === "FacturaProveedorSucursal" && c.rol === "motor2_app" && c.privilege_type === "UPDATE").map((c) => c.columna).sort();
      expect(updates).toEqual(["estadoRecepcion", "operacionId", "recibidaEn", "recibidaPorId"]);
    }
    // La unicidad (empresaId, operacionId) y la política de UPDATE por sucursal siguen.
    expect(f.indices.find((i) => i.nombre === "FacturaProveedorSucursal_empresaId_operacionId_key")?.indexdef).toMatch(/UNIQUE INDEX .*\("empresaId", "operacionId"\)/);
    expect(f.politicas.filter((p) => p.tabla === "FacturaProveedorSucursal").map((p) => p.nombre).sort()).toEqual(["aislamiento_empresa", "alcance_sucursal_delete", "alcance_sucursal_insert", "alcance_sucursal_select", "alcance_sucursal_update"]);
    arriba = f;
  });

  it("2. BAJAR deja el catálogo idéntico al de antes de la migración", async () => {
    await correr("down.sql");
    expect(await foto()).toEqual(antes);
  });

  it("3. BAJAR DOS VECES no falla; SUBIR OTRA VEZ deja el catálogo idéntico al de la primera subida", async () => {
    await correr("down.sql");
    expect(await foto()).toEqual(antes);
    await correr("migration.sql");
    expect(await foto()).toEqual(arriba);
  });
});
