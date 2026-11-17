import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";

/**
 * Compras, recepción separada N3-b: SUBIR, BAJAR y SUBIR de la migración real `20261117120100_compras_control_de_linea_de_recepcion` sobre una base TEMPORAL descartable (`crearBaseTemporalMigrada`: solo Postgres local, jamás
 * una base real), con su `down.sql` tal cual está en el repo. La aplicación a bases reales NO sale de esta rama: la hace la coordinación con respaldo y ensayo.
 *
 * Qué comprueba:
 *  0. La migración existe, avisa que requiere autorización y tiene down.sql y verificacion-previa.sql.
 *  1. SUBIR: aparece la tabla `ControlDeLineaDeRecepcion` (id uuid, instantes con zona), con RLS, su política de empresa, el disparador y SOLO SELECT e INSERT para la app; ninguna otra tabla cambia.
 *  2. BAJAR deja el catálogo (tablas, columnas, índices, restricciones, políticas, disparadores, funciones, privilegios) IDÉNTICO al de antes; se NIEGA con controles cargados.
 *  3. BAJAR DOS VECES no falla; SUBIR OTRA VEZ deja el catálogo idéntico al de la primera subida.
 *
 * Mutaciones (comprobadas a mano al escribirlo): dar UPDATE a la app → rojo el caso 1; sacar el DROP FUNCTION del down.sql → rojo el caso 2.
 */
const RAIZ = join(__dirname, "../../prisma/migrations");
const MIGRACION = "20261117120100_compras_control_de_linea_de_recepcion";
const TABLA = "ControlDeLineaDeRecepcion";
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
    funciones: await q(`SELECT proname::text AS nombre FROM pg_proc WHERE pronamespace = 'public'::regnamespace ORDER BY 1`),
    privilegios: await q(`SELECT table_name::text AS tabla, grantee::text AS rol, privilege_type FROM information_schema.role_table_grants WHERE table_schema = 'public' AND grantee IN ('motor2_app', 'motor2_plataforma') ORDER BY 1, 2, 3`),
    privilegiosPorColumna: await q(`SELECT table_name::text AS tabla, column_name::text AS columna, grantee::text AS rol, privilege_type FROM information_schema.column_privileges WHERE table_schema = 'public' AND grantee IN ('motor2_app', 'motor2_plataforma') ORDER BY 1, 2, 3, 4`),
  };
}
type Foto = Awaited<ReturnType<typeof foto>>;
const hayRol = async (rol: string) => (await q<{ n: string }>(`SELECT count(*)::text AS n FROM pg_roles WHERE rolname = $1`, [rol]))[0]!.n === "1";
const correr = (archivo: "migration.sql" | "down.sql") => base.cliente.query(sql(archivo));
const sinLaTabla = <T extends Record<string, unknown>>(filas: T[]) => filas.filter((f) => f.tabla !== TABLA && f.tabla !== `"${TABLA}"`);

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

describe("Compras N3-b: subir, bajar y subir sobre una base temporal con todo lo anterior aplicado", () => {
  it("0. la migración existe, avisa la autorización y tiene down.sql y verificacion-previa.sql", () => {
    expect(readdirSync(RAIZ)).toContain(MIGRACION);
    expect(sql("migration.sql").split("\n")[0]).toContain("REQUIERE AUTORIZACIÓN EXPRESA");
    expect(sql("down.sql").length).toBeGreaterThan(0);
    expect(readdirSync(join(RAIZ, MIGRACION)).sort()).toEqual(["down.sql", "migration.sql", "verificacion-previa.sql"]);
  });

  it("1. SUBIR: la tabla nueva (uuid, timestamptz, RLS, disparador, solo SELECT e INSERT) y NADA más cambia", async () => {
    await correr("migration.sql");
    const f = await foto();
    // Ninguna otra tabla cambió.
    for (const k of ["tablas", "columnas", "indices", "restricciones", "politicas", "disparadores", "privilegios", "privilegiosPorColumna"] as const) {
      expect(sinLaTabla(f[k] as Record<string, unknown>[]), `catálogo «${k}» sin cambios fuera de la tabla nueva`).toEqual(sinLaTabla(antes[k] as Record<string, unknown>[]));
    }
    expect(f.funciones.map((x) => x.nombre)).toEqual([...antes.funciones.map((x) => x.nombre), "compras_control_de_linea_validar"].sort());
    expect(f.tablas.find((t) => t.tabla === TABLA)).toEqual({ tabla: TABLA, rls: true, forzado: false });
    const col = (c: string) => f.columnas.find((x) => x.tabla === TABLA && x.columna === c);
    expect(col("id")?.data_type).toBe("uuid");
    expect(col("registradoEn")?.data_type).toBe("timestamp with time zone");
    expect(col("empresaId")?.column_default).toBe("app_empresa_actual()");
    expect(f.politicas.filter((p) => p.tabla === TABLA).map((p) => p.nombre)).toEqual(["aislamiento_empresa"]);
    expect(f.disparadores.filter((d) => d.tabla === `"${TABLA}"`).map((d) => d.nombre)).toEqual(["ControlDeLineaDeRecepcion_validar"]);
    const unico = f.indices.find((i) => i.nombre === "ControlDeLineaDeRecepcion_parte_renglon_key");
    expect(unico?.indexdef).toMatch(/UNIQUE INDEX .*\("empresaId", "facturaProveedorSucursalId", "facturaProveedorRenglonId"\)/);
    if (await hayRol("motor2_app")) {
      expect(f.privilegios.filter((p) => p.tabla === TABLA && p.rol === "motor2_app").map((p) => p.privilege_type)).toEqual(["INSERT", "SELECT"]);
      expect(f.privilegiosPorColumna.filter((p) => p.tabla === TABLA && p.privilege_type === "UPDATE")).toEqual([]);
    }
    arriba = f;
  });

  it("2. BAJAR se NIEGA con controles cargados (sin tocar nada) y, con la tabla vacía, deja el catálogo idéntico al de antes", async () => {
    // Una fila suelta (con las claves foráneas y el disparador desactivados solo para esta prueba: lo que importa acá es que el down la vea).
    await base.cliente.query(`SET session_replication_role = replica`);
    await base.cliente.query(
      `INSERT INTO "ControlDeLineaDeRecepcion" ("id","empresaId","facturaProveedorId","facturaProveedorSucursalId","facturaProveedorRenglonId","condicion","observacion","registradoPorId")
       VALUES ('11111111-1111-4111-8111-111111111111','e1','f1','p1','r1','RECHAZADA','Llegó rota','u1')`,
    );
    await base.cliente.query(`SET session_replication_role = DEFAULT`);
    await expect(correr("down.sql")).rejects.toThrow(/No se puede bajar 20261117120100_compras_control_de_linea_de_recepcion: hay 1 control\(es\)/);
    expect(await foto(), "el down abortado no tocó nada").toEqual(arriba);
    await base.cliente.query(`DELETE FROM "ControlDeLineaDeRecepcion"`);
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
