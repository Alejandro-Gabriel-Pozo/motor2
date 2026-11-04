import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";

/**
 * Pagos X0: SUBIR, BAJAR y SUBIR de la migración real `20261104110000_pago_de_factura_proveedor` sobre una base TEMPORAL descartable (`crearBaseTemporalMigrada`: solo Postgres local, jamás una base real), con su
 * `down.sql` tal cual está en el repo. La aplicación a bases reales NO sale de esta rama: la hace la coordinación con respaldo y ensayo.
 *
 * Qué comprueba:
 *  0. La migración existe, avisa que requiere autorización y tiene down.sql.
 *  1. SUBIR: el CHECK de la condición de pago admite las dos condiciones y rechaza otra; las dos tablas nuevas con sus CHECK validados, el índice único parcial de pago VIGENTE, RLS de empresa, y los privilegios:
 *     solo SELECT e INSERT (más UPDATE de `anuladoEn`/`anuladoPorId` en el pago); nada para la plataforma. NINGUNA tabla existente cambia salvo el CHECK ampliado.
 *  2. BAJAR con un pago, una anulación o una factura PENDIENTE_DE_PAGO ABORTA sin tocar nada; sin filas, el catálogo queda IDÉNTICO al de antes.
 *  3. BAJAR DOS VECES no falla; SUBIR OTRA VEZ deja el catálogo idéntico al de la primera subida.
 *
 * Mutación (anotada en el commit): sacar la guarda de filas del down.sql → rojo el caso 2; sacar el `WHERE "anuladoEn" IS NULL` del índice → rojo el caso 1 (se puede volver a declarar un pago tras anular); dar UPDATE de tabla → rojo el caso 1.
 */
const RAIZ = join(__dirname, "../../prisma/migrations");
const MIGRACION = "20261104110000_pago_de_factura_proveedor";
const sql = (archivo: "migration.sql" | "down.sql") => readFileSync(join(RAIZ, MIGRACION, archivo), "utf8");
const NUEVAS = ["AnulacionDePagoDeFacturaProveedor", "PagoDeFacturaProveedor"];

const E = "empresa_x0";
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
const sinLasNuevas = (f: Foto) => Object.fromEntries(Object.entries(f).map(([k, filas]) => [k, (filas as Array<{ tabla: string }>).filter((r) => !NUEVAS.includes(r.tabla.replaceAll('"', "")))]));
const hayRol = async (rol: string) => (await q<{ n: string }>(`SELECT count(*)::text AS n FROM pg_roles WHERE rolname = $1`, [rol]))[0]!.n === "1";

let antes: Foto;
let arriba: Foto;

beforeAll(async () => {
  base = await crearBaseTemporalMigrada();
  await base.aplicarAntesDe(MIGRACION);
  await q(`INSERT INTO "Empresa" ("id","nombre","slug","zonaHoraria","moneda","estado") VALUES ($1,$1,$1,'America/Argentina/Buenos_Aires','ARS','ACTIVE')`, [E]);
  await q(`INSERT INTO "User" ("id","email") VALUES ('u_x0','x0@ejemplo.test')`);
  await q(`INSERT INTO "Proveedor" ("id","empresaId","codigo","nombre") VALUES ('prv',$1,'PRV','Proveedor')`, [E]);
  await q(`INSERT INTO "FacturaProveedor" ("id","empresaId","proveedorId","fecha","importeTotal","estado","confirmadaEn","confirmadaPorId","creadoPorId") VALUES ('fac',$1,'prv',now(),100,'CONFIRMADA',now(),'u_x0','u_x0')`, [E]);
  antes = await foto();
}, 180_000);

afterAll(async () => {
  await base?.eliminar();
}, 60_000);

const correr = (archivo: "migration.sql" | "down.sql") => base.cliente.query(sql(archivo));
const insertarFacturaPendiente = () =>
  q(`INSERT INTO "FacturaProveedor" ("id","empresaId","proveedorId","fecha","importeTotal","condicionPago","estado","confirmadaEn","confirmadaPorId","creadoPorId") VALUES ('pend',$1,'prv',now(),100,'PENDIENTE_DE_PAGO','CONFIRMADA',now(),'u_x0','u_x0')`, [E]);

describe("Pagos X0: subir, bajar y subir sobre una base temporal con todo lo anterior aplicado", () => {
  it("0. la migración existe, avisa la autorización y tiene down.sql", () => {
    expect(readdirSync(RAIZ)).toContain(MIGRACION);
    expect(sql("migration.sql").split("\n")[0]).toContain("REQUIERE AUTORIZACIÓN EXPRESA");
    expect(sql("down.sql").length).toBeGreaterThan(0);
  });

  it("1. SUBIR: condición ampliada, tablas, reglas, índice parcial, RLS y privilegios; nada de lo existente cambia", async () => {
    await correr("migration.sql");
    const f = await foto();
    const existentes = sinLasNuevas(f) as Record<string, Array<Record<string, unknown>>>;
    const previas = sinLasNuevas(antes) as Record<string, Array<Record<string, unknown>>>;
    // La ÚNICA diferencia en lo existente: el CHECK de la condición de pago.
    const sinElCheck = (filas: Array<Record<string, unknown>>) => filas.filter((r) => r.nombre !== "FacturaProveedor_condicion_pago_chk");
    expect({ ...existentes, restricciones: sinElCheck(existentes.restricciones) }).toEqual({ ...previas, restricciones: sinElCheck(previas.restricciones) });
    const check = f.restricciones.find((r) => r.nombre === "FacturaProveedor_condicion_pago_chk");
    expect([check?.convalidated, check?.definicion]).toEqual([true, expect.stringContaining("PENDIENTE_DE_PAGO")]);
    expect(f.tablas.filter((t) => NUEVAS.includes(t.tabla as string))).toEqual(NUEVAS.map((tabla) => ({ tabla, rls: true })));
    for (const nombre of ["PagoDeFacturaProveedor_medio_chk", "PagoDeFacturaProveedor_anulacion_pareo_chk", "AnulacionDePagoDeFacturaProveedor_motivo_chk"]) {
      const r = f.restricciones.find((x) => x.nombre === nombre);
      expect([r?.contype, r?.convalidated], `${nombre}: CHECK validado`).toEqual(["c", true]);
    }
    expect(f.indices.find((i) => i.nombre === "PagoDeFacturaProveedor_vigente_key")?.indexdef).toMatch(/UNIQUE INDEX .*\("facturaProveedorId"\) WHERE \("anuladoEn" IS NULL\)$/);
    expect(f.indices.find((i) => i.nombre === "PagoDeFacturaProveedor_claveIdempotencia_key")?.indexdef).toMatch(/UNIQUE INDEX/);
    expect(f.indices.find((i) => i.nombre === "AnulacionDePagoDeFacturaProveedor_pagoId_key")?.indexdef).toMatch(/UNIQUE INDEX/);
    for (const t of NUEVAS) expect(f.politicas.filter((p) => p.tabla === t).map((p) => p.nombre), t).toEqual(["aislamiento_empresa"]);
    if (await hayRol("motor2_app")) {
      const deTabla = (tabla: string) => f.privilegios.filter((p) => p.tabla === tabla).map((p) => `${p.rol}:${p.privilege_type}`).sort();
      for (const t of NUEVAS) expect(deTabla(t), `${t}: solo SELECT e INSERT de tabla para la app, nada para la plataforma`).toEqual(["motor2_app:INSERT", "motor2_app:SELECT"]);
      const updates = f.privilegiosPorColumna.filter((p) => NUEVAS.includes(p.tabla as string) && p.privilege_type === "UPDATE").map((p) => `${p.tabla}.${p.columna}`).sort();
      expect(updates, "UPDATE solo de la marca de anulación del pago").toEqual(["PagoDeFacturaProveedor.anuladoEn", "PagoDeFacturaProveedor.anuladoPorId"]);
    }
    // Comportamiento real: la condición pendiente entra, otra no; un solo pago vigente por factura; tras anular se puede declarar otro.
    await insertarFacturaPendiente();
    await expect(q(`INSERT INTO "FacturaProveedor" ("id","empresaId","proveedorId","fecha","importeTotal","condicionPago","estado","confirmadaEn","confirmadaPorId","creadoPorId") VALUES ('mala',$1,'prv',now(),1,'OTRA','CONFIRMADA',now(),'u_x0','u_x0')`, [E])).rejects.toThrow(/FacturaProveedor_condicion_pago_chk/);
    const pago = (id: string, clave: string) =>
      q(`INSERT INTO "PagoDeFacturaProveedor" ("id","empresaId","facturaProveedorId","fechaPago","medio","claveIdempotencia","payloadHash","resultadoMensaje","creadoPorId") VALUES ($1,$2,'pend','2026-11-04','EFECTIVO',$3,'h','ok','u_x0')`, [id, E, clave]);
    await pago("p1", "k1");
    await expect(pago("p2", "k2")).rejects.toThrow(/PagoDeFacturaProveedor_vigente_key/);
    await q(`UPDATE "PagoDeFacturaProveedor" SET "anuladoEn" = now(), "anuladoPorId" = 'u_x0' WHERE "id" = 'p1'`);
    await pago("p2", "k2");
    await q(`DELETE FROM "PagoDeFacturaProveedor"`);
    await q(`DELETE FROM "FacturaProveedor" WHERE "id" = 'pend'`);
    arriba = f;
  });

  it("2. BAJAR con un pago, una anulación o una factura pendiente ABORTA sin tocar nada; sin filas, el catálogo queda igual que antes", async () => {
    await insertarFacturaPendiente();
    await expect(correr("down.sql")).rejects.toThrow(/hay 0 pago\(s\), 0 anulación\(es\) de pago y 1 factura\(s\) PENDIENTE_DE_PAGO/);
    await q(`INSERT INTO "PagoDeFacturaProveedor" ("id","empresaId","facturaProveedorId","fechaPago","medio","claveIdempotencia","payloadHash","resultadoMensaje","creadoPorId") VALUES ('p1',$1,'pend','2026-11-04','EFECTIVO','k1','h','ok','u_x0')`, [E]);
    await expect(correr("down.sql")).rejects.toThrow(/hay 1 pago\(s\), 0 anulación\(es\) de pago y 1 factura\(s\)/);
    await q(`INSERT INTO "AnulacionDePagoDeFacturaProveedor" ("id","empresaId","pagoId","motivo","claveIdempotencia","payloadHash","resultadoMensaje","creadoPorId") VALUES ('a1',$1,'p1','error','k2','h','ok','u_x0')`, [E]);
    await expect(correr("down.sql")).rejects.toThrow(/hay 1 pago\(s\), 1 anulación\(es\) de pago/);
    expect((await foto()).tablas, "la reversa abortada no tocó el catálogo").toEqual(arriba.tablas);
    await q(`DELETE FROM "AnulacionDePagoDeFacturaProveedor"`);
    await q(`DELETE FROM "PagoDeFacturaProveedor"`);
    await q(`DELETE FROM "FacturaProveedor" WHERE "id" = 'pend'`);
    await correr("down.sql");
    expect(await foto(), "sin filas, bajar deja el catálogo idéntico al de antes de X0").toEqual(antes);
  });

  it("3. bajar dos veces no falla; subir otra vez deja el catálogo idéntico al de la primera subida", async () => {
    await correr("down.sql");
    expect(await foto()).toEqual(antes);
    await correr("migration.sql");
    expect(await foto()).toEqual(arriba);
  });
});
