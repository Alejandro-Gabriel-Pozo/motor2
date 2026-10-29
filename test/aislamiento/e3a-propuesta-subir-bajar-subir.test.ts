import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";

/**
 * E3a-M (ADR-041): SUBIR, BAJAR y SUBIR de las dos migraciones reales `20261028100000_factura_proveedor_propuesta` (tablas) y `20261028101000_rls_sucursal_factura_proveedor_propuesta` (políticas) sobre una base TEMPORAL
 * descartable (`crearBaseTemporalMigrada`: solo Postgres local, jamás una base real), con sus `down.sql` tal cual están en el repo. El dueño la autorizó el 2026-10-28 SOLO en bases locales.
 *
 * Qué comprueba:
 *  0. Las dos migraciones existen, en orden, son las últimas, avisan que requieren autorización y tienen down.sql.
 *  1. SUBIR: las tres tablas con sus CHECK validados, sus claves foráneas (la de cinco columnas de los renglones hacia su propuesta, la de tres hacia el renglón de la MISMA factura), RLS de empresa en las tres, las 4 políticas de
 *     sucursal en las dos primeras, y los privilegios: solo SELECT e INSERT, más UPDATE por columna de la aceptación en la propuesta; nada para la plataforma. NINGUNA tabla existente cambia (columnas, índices,
 *     restricciones, políticas y privilegios de las tablas de antes, idénticos).
 *  2. BAJAR con una propuesta (o una anulación) ABORTA sin tocar nada; sin filas, el catálogo queda IDÉNTICO al de antes.
 *  3. BAJAR DOS VECES no falla; SUBIR OTRA VEZ deja el catálogo idéntico al de la primera subida.
 *
 * Mutación (anotada en el commit): sacar el GRANT UPDATE por columna, darle UPDATE de tabla, o borrar el CHECK de aceptación coherente del migration.sql → rojo el caso 1; sacar la guarda de filas del down.sql → rojo el caso 2.
 */
const RAIZ = join(__dirname, "../../prisma/migrations");
const TABLAS = "20261028100000_factura_proveedor_propuesta";
const POLITICAS = "20261028101000_rls_sucursal_factura_proveedor_propuesta";
const sql = (m: string, archivo: "migration.sql" | "down.sql") => readFileSync(join(RAIZ, m, archivo), "utf8");
const NUEVAS = ["AnulacionDeFacturaProveedor", "FacturaProveedorPropuesta", "FacturaProveedorPropuestaRenglon"];

const E = "empresa_e3a";
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
    privilegiosPorColumna: await q(`SELECT table_name::text AS tabla, column_name::text AS columna, grantee::text AS rol, privilege_type FROM information_schema.column_privileges WHERE table_schema = 'public' AND grantee IN ('motor2_app', 'motor2_plataforma') ORDER BY 1, 2, 3, 4`),
  };
}
type Foto = Awaited<ReturnType<typeof foto>>;
/** La foto SIN las tres tablas nuevas: lo que tiene que quedar igual al subir. */
const sinLasNuevas = (f: Foto) => Object.fromEntries(Object.entries(f).map(([k, filas]) => [k, (filas as Array<{ tabla: string }>).filter((r) => !NUEVAS.includes(r.tabla.replaceAll('"', "")))]));
const hayRol = async (rol: string) => (await q<{ n: string }>(`SELECT count(*)::text AS n FROM pg_roles WHERE rolname = $1`, [rol]))[0]!.n === "1";

let antes: Foto;
let arriba: Foto;

beforeAll(async () => {
  base = await crearBaseTemporalMigrada();
  await base.aplicarAntesDe(TABLAS);
  await q(`INSERT INTO "Empresa" ("id","nombre","slug","zonaHoraria","moneda","estado") VALUES ($1,$1,$1,'America/Argentina/Buenos_Aires','ARS','ACTIVE')`, [E]);
  await q(`INSERT INTO "Sucursal" ("id","empresaId","nombre") VALUES ('suc_3',$1,'Tres'), ('suc_4',$1,'Cuatro')`, [E]);
  await q(`INSERT INTO "User" ("id","email") VALUES ('u_e3a','e3a@ejemplo.test')`);
  await q(`INSERT INTO "Proveedor" ("id","empresaId","codigo","nombre") VALUES ('prv',$1,'PRV','Proveedor')`, [E]);
  await q(`INSERT INTO "FacturaProveedor" ("id","empresaId","proveedorId","fecha","importeTotal","estado","confirmadaEn","confirmadaPorId","creadoPorId") VALUES ('fac',$1,'prv',now(),100,'CONFIRMADA',now(),'u_e3a','u_e3a')`, [E]);
  antes = await foto();
}, 180_000);

afterAll(async () => {
  await base?.eliminar();
}, 60_000);

const correr = (m: string, archivo: "migration.sql" | "down.sql") => base.cliente.query(sql(m, archivo));
const subir = async () => {
  await correr(TABLAS, "migration.sql");
  await correr(POLITICAS, "migration.sql");
};
const bajar = async () => {
  await correr(POLITICAS, "down.sql");
  await correr(TABLAS, "down.sql");
};

describe("E3a-M: subir, bajar y subir sobre una base temporal con todo lo anterior aplicado", () => {
  it("0. las dos migraciones existen, son las últimas, en orden, avisan la autorización y tienen down.sql", () => {
    const carpetas = readdirSync(RAIZ, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
    // Las últimas DE ESTA ETAPA: después vinieron migraciones de otras etapas (20261029120000, «Mostrar este grupo en la carta», decisión del dueño 2026-10-29), que no las desplazan de su lugar relativo.
    expect(carpetas.filter((c) => c <= POLITICAS).slice(-2)).toEqual([TABLAS, POLITICAS]);
    for (const m of [TABLAS, POLITICAS]) {
      expect(sql(m, "migration.sql").split("\n")[0]).toContain("REQUIERE AUTORIZACIÓN EXPRESA");
      expect(sql(m, "down.sql").length).toBeGreaterThan(0);
    }
  });

  it("1. SUBIR: tablas, reglas, claves foráneas, RLS, políticas y privilegios; nada de lo existente cambia", async () => {
    await subir();
    const f = await foto();
    expect(sinLasNuevas(f), "ninguna tabla existente cambió").toEqual(sinLasNuevas(antes));
    expect(f.tablas.filter((t) => NUEVAS.includes(t.tabla as string))).toEqual(NUEVAS.map((tabla) => ({ tabla, rls: true })));
    const restr = (nombre: string) => f.restricciones.find((r) => r.nombre === nombre);
    for (const nombre of [
      "FacturaProveedorPropuesta_sucursales_distintas_chk",
      "FacturaProveedorPropuesta_porcentaje_chk",
      "FacturaProveedorPropuesta_estado_chk",
      "FacturaProveedorPropuesta_aceptacion_coherente_chk",
      "FacturaProveedorPropuestaRenglon_cantidad_positiva_chk",
      "FacturaProveedorPropuestaRenglon_precio_no_negativo_chk",
      "AnulacionDeFacturaProveedor_motivo_chk",
    ]) {
      expect([restr(nombre)?.contype, restr(nombre)?.convalidated], `${nombre}: CHECK validado`).toEqual(["c", true]);
    }
    expect(restr("FacturaProveedorPropuestaRenglon_propuesta_fkey")?.definicion).toBe(
      'FOREIGN KEY ("empresaId", "facturaProveedorId", "propuestaId", "origenSucursalId", "destinoSucursalId") REFERENCES "FacturaProveedorPropuesta"("empresaId", "facturaProveedorId", id, "origenSucursalId", "destinoSucursalId") ON UPDATE RESTRICT ON DELETE RESTRICT',
    );
    expect(restr("FacturaProveedorPropuestaRenglon_renglon_fkey")?.definicion).toBe(
      'FOREIGN KEY ("empresaId", "facturaProveedorId", "facturaProveedorRenglonId") REFERENCES "FacturaProveedorRenglon"("empresaId", "facturaProveedorId", id) ON UPDATE RESTRICT ON DELETE RESTRICT',
    );
    expect(f.indices.find((i) => i.nombre === "FacturaProveedorPropuesta_facturaProveedorId_destinoSucursa_key")?.indexdef).toMatch(/UNIQUE INDEX .*\("facturaProveedorId", "destinoSucursalId"\)$/);
    expect(f.indices.find((i) => i.nombre === "AnulacionDeFacturaProveedor_facturaProveedorId_key")?.indexdef).toMatch(/UNIQUE INDEX/);
    const politicas = (tabla: string) => f.politicas.filter((p) => p.tabla === tabla).map((p) => p.nombre).sort();
    expect(politicas("FacturaProveedorPropuesta")).toEqual(["aislamiento_empresa", "alcance_sucursal_delete", "alcance_sucursal_insert", "alcance_sucursal_select", "alcance_sucursal_update"]);
    expect(politicas("FacturaProveedorPropuestaRenglon")).toEqual(["aislamiento_empresa", "alcance_sucursal_delete", "alcance_sucursal_insert", "alcance_sucursal_select", "alcance_sucursal_update"]);
    expect(politicas("AnulacionDeFacturaProveedor")).toEqual(["aislamiento_empresa"]);
    if (await hayRol("motor2_app")) {
      const deTabla = (tabla: string) => f.privilegios.filter((p) => p.tabla === tabla).map((p) => `${p.rol}:${p.privilege_type}`).sort();
      for (const t of NUEVAS) expect(deTabla(t), `${t}: solo SELECT e INSERT de tabla para la app, nada para la plataforma`).toEqual(["motor2_app:INSERT", "motor2_app:SELECT"]);
      const updates = f.privilegiosPorColumna.filter((p) => NUEVAS.includes(p.tabla as string) && p.privilege_type === "UPDATE").map((p) => `${p.tabla}.${p.columna}`).sort();
      expect(updates, "UPDATE solo de la aceptación de la propuesta").toEqual(["FacturaProveedorPropuesta.aceptadaEn", "FacturaProveedorPropuesta.aceptadaPorId", "FacturaProveedorPropuesta.estado", "FacturaProveedorPropuesta.parteId"]);
    }
    arriba = f;
  });

  it("2. BAJAR con una propuesta o una anulación ABORTA sin tocar nada; sin filas, el catálogo queda igual que antes", async () => {
    await q(`INSERT INTO "FacturaProveedorPropuesta" ("id","empresaId","facturaProveedorId","origenSucursalId","destinoSucursalId","porcentajeDeclaradoBp","creadoPorId") VALUES ('pro',$1,'fac','suc_3','suc_4',5000,'u_e3a')`, [E]);
    await correr(POLITICAS, "down.sql");
    await expect(correr(TABLAS, "down.sql")).rejects.toThrow(/No se puede bajar 20261028100000_factura_proveedor_propuesta: hay 1 propuesta\(s\), 0 renglón\(es\) de propuesta y 0 anulación\(es\)/);
    await correr(POLITICAS, "migration.sql");
    expect(await foto(), "la reversa abortada no tocó el catálogo").toEqual(arriba);
    await q(`DELETE FROM "FacturaProveedorPropuesta"`);
    await q(`INSERT INTO "AnulacionDeFacturaProveedor" ("id","empresaId","facturaProveedorId","motivo","claveIdempotencia","payloadHash","resultadoMensaje","creadoPorId") VALUES ('anu',$1,'fac','error','k1','h','ok','u_e3a')`, [E]);
    await correr(POLITICAS, "down.sql");
    await expect(correr(TABLAS, "down.sql")).rejects.toThrow(/0 propuesta\(s\), 0 renglón\(es\) de propuesta y 1 anulación\(es\)/);
    await correr(POLITICAS, "migration.sql");
    await q(`DELETE FROM "AnulacionDeFacturaProveedor"`);
    await bajar();
    expect(await foto(), "sin filas, bajar deja el catálogo idéntico al de antes de E3a-M").toEqual(antes);
  });

  it("3. bajar dos veces no falla (la de las tablas; la de políticas se baja solo con las tablas puestas); subir otra vez deja el catálogo idéntico al de la primera subida", async () => {
    await correr(TABLAS, "down.sql");
    expect(await foto()).toEqual(antes);
    await subir();
    expect(await foto()).toEqual(arriba);
  });
});
