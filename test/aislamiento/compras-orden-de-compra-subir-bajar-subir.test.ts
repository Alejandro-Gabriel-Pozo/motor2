import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";

/**
 * Compras, orden de compra (etapa OC): SUBIR, BAJAR y SUBIR de las TRES migraciones reales (`20261117130000_compras_orden_de_compra`, `20261117130100_rls_sucursal_orden_de_compra`, `20261117130200_compras_permisos_orden_de_compra`) sobre una base
 * TEMPORAL descartable (`crearBaseTemporalMigrada`: solo Postgres local, jamás una base real), con sus `down.sql` tal cual están en el repo. La aplicación a bases reales NO sale de esta rama: la hace la coordinación con respaldo y ensayo.
 *
 * Qué comprueba:
 *  0. Las tres migraciones existen, la primera avisa que requiere autorización y todas tienen down.sql (las dos con datos, también verificacion-previa.sql).
 *  1. SUBIR: aparecen las 5 tablas (uuid, instantes con zona, RLS, política de empresa y las 4 de sucursal, disparadores) y las 3 acciones; la app solo tiene SELECT e INSERT/UPDATE por columna (ni DELETE ni TRUNCATE); ninguna otra tabla cambia.
 *  2. BAJAR en orden inverso deja el catálogo (tablas, columnas, índices, restricciones, políticas, disparadores, funciones, privilegios) IDÉNTICO al de antes; se NIEGA con órdenes o con configuración a mano cargadas, sin tocar nada.
 *  3. BAJAR DOS VECES no falla; SUBIR OTRA VEZ deja el catálogo idéntico al de la primera subida.
 *
 * Mutaciones (comprobadas a mano al escribirlo): dar DELETE a la app → rojo el caso 1; sacar un DROP FUNCTION del down.sql de 130000 → rojo el caso 2.
 */
const RAIZ = join(__dirname, "../../prisma/migrations");
const M = { tablas: "20261117130000_compras_orden_de_compra", rls: "20261117130100_rls_sucursal_orden_de_compra", permisos: "20261117130200_compras_permisos_orden_de_compra" };
const TABLAS = ["OrdenDeCompra", "LineaDeOrdenDeCompra", "SaldoDeLineaDeOrden", "VinculoDeRenglonConOrden", "NivelDeControl"];
const CLAVES = ["orden_de_compra_gestionar", "compras_configurar", "orden_de_compra_ver"];
const sql = (m: string, archivo: "migration.sql" | "down.sql") => readFileSync(join(RAIZ, m, archivo), "utf8");

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
    acciones: await q(`SELECT "clave"::text AS clave, "descripcion"::text AS descripcion FROM "Accion" ORDER BY 1`),
    permisosDeRol: await q(`SELECT "rolId"::text AS rol, "accionClave"::text AS clave, "puedeVer", "puedeEditar" FROM "PermisoRol" ORDER BY 1, 2`),
  };
}
type Foto = Awaited<ReturnType<typeof foto>>;
const hayRol = async (rol: string) => (await q<{ n: string }>(`SELECT count(*)::text AS n FROM pg_roles WHERE rolname = $1`, [rol]))[0]!.n === "1";
const subir = async () => {
  for (const m of [M.tablas, M.rls, M.permisos]) await base.cliente.query(sql(m, "migration.sql"));
};
const bajar = async () => {
  for (const m of [M.permisos, M.rls, M.tablas]) await base.cliente.query(sql(m, "down.sql"));
};
const deLasTablas = <T extends Record<string, unknown>>(filas: T[]) => filas.filter((f) => TABLAS.some((t) => f.tabla === t || f.tabla === `"${t}"`));
const fueraDeLasTablas = <T extends Record<string, unknown>>(filas: T[]) => filas.filter((f) => !TABLAS.some((t) => f.tabla === t || f.tabla === `"${t}"`));

let antes: Foto;
let arriba: Foto;

beforeAll(async () => {
  base = await crearBaseTemporalMigrada();
  await base.aplicarAntesDe(M.tablas);
  antes = await foto();
}, 180_000);

afterAll(async () => {
  await base?.eliminar();
}, 60_000);

describe("Compras OC: subir, bajar y subir sobre una base temporal con todo lo anterior aplicado", () => {
  it("0. las tres migraciones existen, la primera avisa la autorización y todas tienen down.sql", () => {
    const carpetas = readdirSync(RAIZ);
    for (const m of Object.values(M)) {
      expect(carpetas).toContain(m);
      expect(sql(m, "down.sql").length).toBeGreaterThan(0);
    }
    expect(sql(M.tablas, "migration.sql").split("\n")[0]).toContain("REQUIERE AUTORIZACIÓN EXPRESA");
    expect(readdirSync(join(RAIZ, M.tablas)).sort()).toEqual(["down.sql", "migration.sql", "verificacion-previa.sql"]);
    expect(readdirSync(join(RAIZ, M.permisos)).sort()).toEqual(["down.sql", "migration.sql", "verificacion-previa.sql"]);
  });

  it("1. SUBIR: las 5 tablas (uuid, timestamptz, RLS, política de empresa y de sucursal, disparadores), las 3 acciones, la app sin DELETE, y NADA más cambia", async () => {
    await subir();
    const f = await foto();
    // Fuera de las tablas nuevas solo cambian los dos disparadores que se cuelgan de la factura de proveedor (y sus funciones).
    const sinLosDeLaFactura = <T extends Record<string, unknown>>(filas: T[]) => filas.filter((d) => !/_a_la_orden$/.test(String(d.nombre ?? "")));
    for (const k of ["tablas", "columnas", "indices", "restricciones", "politicas", "disparadores", "privilegios", "privilegiosPorColumna"] as const) {
      expect(sinLosDeLaFactura(fueraDeLasTablas(f[k] as Record<string, unknown>[])), `catálogo «${k}» sin cambios fuera de las tablas nuevas`).toEqual(sinLosDeLaFactura(fueraDeLasTablas(antes[k] as Record<string, unknown>[])));
    }
    expect(f.disparadores.filter((d) => /_a_la_orden$/.test(String(d.nombre))).map((d) => d.nombre).sort()).toEqual(["FacturaProveedorSucursal_suma_a_la_orden", "FacturaProveedor_devuelve_a_la_orden"]);
    expect(f.tablas.filter((t) => TABLAS.includes(String(t.tabla))).map((t) => [t.tabla, t.rls, t.forzado]).sort()).toEqual(TABLAS.map((t) => [t, true, false]).sort());
    const col = (t: string, c: string) => f.columnas.find((x) => x.tabla === t && x.columna === c);
    expect(col("OrdenDeCompra", "id")?.data_type).toBe("uuid");
    expect(col("OrdenDeCompra", "creadoEn")?.data_type).toBe("timestamp with time zone");
    expect(col("OrdenDeCompra", "empresaId")?.column_default).toBe("app_empresa_actual()");
    for (const t of TABLAS) expect(f.politicas.filter((p) => p.tabla === t).map((p) => p.nombre), `políticas de ${t}`).toContain("aislamiento_empresa");
    for (const t of TABLAS.filter((x) => x !== "NivelDeControl")) expect(f.politicas.filter((p) => p.tabla === t).map((p) => p.nombre).sort(), `políticas de ${t}`).toEqual(["aislamiento_empresa", "alcance_sucursal_delete", "alcance_sucursal_insert", "alcance_sucursal_select", "alcance_sucursal_update"].sort());
    expect(f.acciones.filter((a) => CLAVES.includes(String(a.clave))).map((a) => a.clave)).toEqual([...CLAVES].sort());
    if (await hayRol("motor2_app")) {
      const privilegios = f.privilegios.filter((p) => TABLAS.includes(String(p.tabla)) && p.rol === "motor2_app");
      expect(privilegios.some((p) => p.privilege_type === "DELETE" || p.privilege_type === "TRUNCATE"), "la app no borra órdenes").toBe(false);
      expect(privilegios.filter((p) => p.privilege_type === "SELECT").length).toBe(TABLAS.length);
    }
    arriba = f;
  });

  it("2. BAJAR se NIEGA con órdenes o con configuración a mano cargadas (sin tocar nada) y, con todo vacío, deja el catálogo idéntico al de antes", async () => {
    await base.cliente.query(`SET session_replication_role = replica`);
    await base.cliente.query(`INSERT INTO "NivelDeControl" ("id","empresaId","control","nivel","actualizadoPorId") VALUES ('11111111-1111-4111-8111-111111111111','e1','compras.recepcion_excede_la_orden','AVISAR','u1')`);
    await base.cliente.query(`SET session_replication_role = DEFAULT`);
    const despuesDeLasPoliticas = await foto();
    await expect(base.cliente.query(sql(M.tablas, "down.sql"))).rejects.toThrow(/No se puede bajar 20261117130000_compras_orden_de_compra: hay 0 orden\(es\), 0 línea\(s\), 0 saldo\(s\), 0 vínculo\(s\) y 1 nivel\(es\)/);
    expect(await foto(), "el down abortado no tocó nada").toEqual(despuesDeLasPoliticas);
    await base.cliente.query(`DELETE FROM "NivelDeControl"`);

    // Configuración hecha a mano de una clave: el down de los permisos aborta sin tocar nada.
    await base.cliente.query(`SET session_replication_role = replica`);
    await base.cliente.query(`INSERT INTO "CapacidadSucursal" ("id","empresaId","accionClave","sucursalId","habilitado") VALUES ('cap1','e1','orden_de_compra_gestionar',NULL,true)`);
    await base.cliente.query(`SET session_replication_role = DEFAULT`);
    await expect(base.cliente.query(sql(M.permisos, "down.sql"))).rejects.toThrow(/hecha a mano/);
    await base.cliente.query(`DELETE FROM "CapacidadSucursal" WHERE "id" = 'cap1'`);
    expect((await foto()).acciones.filter((a) => CLAVES.includes(String(a.clave)))).toHaveLength(3);

    await bajar();
    expect(await foto()).toEqual(antes);
  });

  it("3. BAJAR DOS VECES no falla; SUBIR OTRA VEZ deja el catálogo idéntico al de la primera subida", async () => {
    await bajar();
    expect(await foto()).toEqual(antes);
    await subir();
    expect(await foto()).toEqual(arriba);
    expect(deLasTablas((await foto()).tablas)).toHaveLength(TABLAS.length);
  });
});
