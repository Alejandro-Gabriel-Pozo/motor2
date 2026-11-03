import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";

/**
 * M1 del mostrador (ADR-039): SUBIR, BAJAR y SUBIR de la migración real `20261027100000_m1_puesto_mostrador` sobre una base TEMPORAL descartable (`crearBaseTemporalMigrada`: solo Postgres local, jamás `motor2_dev`, `motor2_e2e`
 * ni una base real), con su `down.sql` tal cual está en el repo. Parte del estado de producción antes de M1: todas las migraciones anteriores aplicadas, con mesas, cuentas abiertas y cerradas y una venta con ticket.
 *
 * Qué comprueba:
 *  1. La GUARDA de la subida: con una mesa de número <= 0 la migración aborta sin tocar nada.
 *  2. ARRIBA: las mesas y cuentas existentes quedan SALON (default, sin UPDATE) y TODO lo demás intacto; las reglas nuevas, el único, la FK con discriminador RESTRICT y los CHECK están y validados; sin políticas ni privilegios nuevos.
 *  3. ABAJO: con un puesto mostrador o una cuenta suya, la reversa ABORTA sin tocar nada (el catálogo y las filas no cambian); sin ellos, el catálogo queda IDÉNTICO al de antes de M1 (columnas, índices, restricciones, políticas, RLS,
 *     privilegios), con la FK original (ON UPDATE CASCADE) recreada y las filas intactas.
 *  4. BAJAR DOS VECES no falla; SUBIR OTRA VEZ deja el catálogo idéntico al de la primera subida.
 */
const RAIZ = join(__dirname, "../../prisma/migrations");
const M1 = "20261027100000_m1_puesto_mostrador";
const sql = (archivo: "migration.sql" | "down.sql") => readFileSync(join(RAIZ, M1, archivo), "utf8");

const E = "empresa_m1";
let base: BaseTemporalMigrada;

const correr = (archivo: "migration.sql" | "down.sql") => base.cliente.query(sql(archivo));
const q = <T extends object = Record<string, unknown>>(texto: string, params: unknown[] = []) => base.cliente.query<T>(texto, params).then((r) => r.rows);

/** Una foto del catálogo de `public` que cubre todo lo que M1 toca: se compara antes de M1, después de bajarla y después de subirla otra vez. */
async function foto() {
  return {
    politicas: await q(`SELECT tablename::text AS tabla, policyname::text AS nombre, permissive, roles::text AS roles, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public' ORDER BY 1, 2`),
    columnas: await q(`SELECT table_name::text AS tabla, column_name::text AS columna, data_type, udt_name::text AS udt, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' ORDER BY 1, ordinal_position`),
    indices: await q(`SELECT tablename::text AS tabla, indexname::text AS nombre, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY 1, 2`),
    restricciones: await q(`SELECT conrelid::regclass::text AS tabla, conname::text AS nombre, contype, convalidated, pg_get_constraintdef(oid) AS definicion FROM pg_constraint WHERE connamespace = 'public'::regnamespace ORDER BY 1, 2`),
    rls: await q(`SELECT relname::text AS tabla, relrowsecurity AS rls, relforcerowsecurity AS forzado FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' ORDER BY 1`),
    privilegios: await q(`SELECT table_name::text AS tabla, grantee::text AS rol, privilege_type FROM information_schema.role_table_grants WHERE table_schema = 'public' AND grantee IN ('motor2_app', 'motor2_plataforma') ORDER BY 1, 2, 3`),
    privilegiosPorColumna: await q(`SELECT table_name::text AS tabla, column_name::text AS columna, grantee::text AS rol, privilege_type FROM information_schema.column_privileges WHERE table_schema = 'public' AND grantee IN ('motor2_app', 'motor2_plataforma') AND table_name IN ('Mesa', 'Cuenta') ORDER BY 1, 2, 3, 4`),
  };
}

/** Las filas de Mesa y Cuenta SIN las columnas nuevas, para comprobar que subir y bajar no tocan lo existente. */
const filas = async () => ({
  mesas: await q(`SELECT id, "empresaId", "sucursalId", numero, "creadoEn" FROM "Mesa" ORDER BY id`),
  cuentas: await q(`SELECT id, "empresaId", "mesaId", "abiertaPorId", "abiertaEn", "cerradaEn", comensales, "clienteId", "descuentoPorcentaje" FROM "Cuenta" ORDER BY id`),
});

let antesDeM1: Awaited<ReturnType<typeof foto>>;
let filasAntes: Awaited<ReturnType<typeof filas>>;
let arribaLaPrimeraVez: Awaited<ReturnType<typeof foto>>;

beforeAll(async () => {
  base = await crearBaseTemporalMigrada();
  await base.aplicarAntesDe(M1);
  const c = base.cliente;
  await c.query(`INSERT INTO "Empresa" ("id","nombre","slug","zonaHoraria","moneda","estado") VALUES ($1,$1,$1,'America/Argentina/Buenos_Aires','ARS','ACTIVE')`, [E]);
  await c.query(`INSERT INTO "Sucursal" ("id","empresaId","nombre") VALUES ('suc_a',$1,'Centro'), ('suc_b',$1,'Norte')`, [E]);
  await c.query(`INSERT INTO "User" ("id","email") VALUES ('u_m1','m1@ejemplo.test')`);
  // Lo que existe ANTES de M1: tres mesas, una cuenta abierta con comensales, una cerrada y una cerrada sin comensales (abierta antes de existir el dato).
  await c.query(`INSERT INTO "Mesa" ("id","empresaId","sucursalId","numero") VALUES ('mesa_1',$1,'suc_a',1), ('mesa_2',$1,'suc_a',2), ('mesa_b1',$1,'suc_b',1)`, [E]);
  await c.query(`INSERT INTO "Cuenta" ("id","empresaId","mesaId","abiertaPorId","comensales") VALUES ('cta_abierta',$1,'mesa_1','u_m1',3)`, [E]);
  await c.query(`INSERT INTO "Cuenta" ("id","empresaId","mesaId","abiertaPorId","cerradaEn","cerradaPorId","comensales") VALUES ('cta_cerrada',$1,'mesa_2','u_m1',now(),'u_m1',2)`, [E]);
  await c.query(`INSERT INTO "Cuenta" ("id","empresaId","mesaId","abiertaPorId","cerradaEn","cerradaPorId") VALUES ('cta_vieja',$1,'mesa_b1','u_m1',now(),'u_m1')`, [E]);
  antesDeM1 = await foto();
  filasAntes = await filas();
}, 120_000);

afterAll(async () => {
  await base?.eliminar();
}, 60_000);

describe("M1 del mostrador: subir, bajar y subir sobre una base temporal con todo lo anterior aplicado", () => {
  it("0. la migración existe, es posterior a todas las demás, avisa que requiere autorización y tiene down.sql", () => {
    const carpetas = readdirSync(RAIZ, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
    // Posterior a todas las anteriores; después de ella solo vinieron la de E2 (ADR-040, costo del origen en el traspaso) las dos de E3a-M (ADR-041, propuesta de parte de factura) y la de «Mostrar este grupo en la carta» (2026-10-29, decisión del dueño), de otras etapas.
    expect(carpetas.filter((c) => c > M1), "es posterior a todas las anteriores (20261021140000, la migración «solo salón» de otro carril…)").toEqual(["20261027120000_traspaso_costo_unitario_origen", "20261028100000_factura_proveedor_propuesta", "20261028101000_rls_sucursal_factura_proveedor_propuesta", "20261029120000_producto_admite_grupo_se_muestra_en_carta"]);
    expect(M1 > "20261026120000_promo_carta_solo_salon").toBe(true);
    expect(sql("migration.sql").split("\n")[0]).toContain("REQUIERE AUTORIZACIÓN EXPRESA");
    expect(sql("down.sql").length).toBeGreaterThan(0);
  });

  it("1. GUARDA: con una mesa de número <= 0 la migración aborta sin tocar nada", async () => {
    await base.cliente.query(`INSERT INTO "Mesa" ("id","empresaId","sucursalId","numero") VALUES ('mesa_cero',$1,'suc_b',0)`, [E]);
    await expect(correr("migration.sql")).rejects.toThrow(/hay 1 mesa\(s\) con número <= 0/);
    const f = await foto();
    for (const k of Object.keys(antesDeM1) as (keyof typeof antesDeM1)[]) expect(f[k], `catálogo «${k}» sin cambios tras la guarda`).toEqual(antesDeM1[k]);
    await base.cliente.query(`DELETE FROM "Mesa" WHERE id = 'mesa_cero'`);
  });

  it("2. SUBIR: las filas existentes quedan SALON sin tocar nada más; reglas, único y FK con discriminador puestos; sin políticas ni privilegios nuevos", async () => {
    await correr("migration.sql");
    expect(await filas(), "ninguna fila existente cambió (sin UPDATE)").toEqual(filasAntes);
    expect(await q(`SELECT DISTINCT tipo FROM "Mesa"`), "toda mesa existente es de salón").toEqual([{ tipo: "SALON" }]);
    expect(await q(`SELECT DISTINCT "tipoMesa" FROM "Cuenta"`), "toda cuenta existente es de salón").toEqual([{ tipoMesa: "SALON" }]);

    const f = await foto();
    const restr = (nombre: string) => f.restricciones.find((r) => r.nombre === nombre);
    for (const nombre of ["Mesa_tipo_chk", "Mesa_numero_segun_tipo_chk", "Cuenta_tipoMesa_chk", "Cuenta_comensales_segun_tipo_chk"]) {
      expect([restr(nombre)?.contype, restr(nombre)?.convalidated], `${nombre}: CHECK validado`).toEqual(["c", true]);
    }
    expect(restr("Cuenta_empresaId_mesaId_fkey"), "la FK anterior ya no está").toBeUndefined();
    expect(restr("Cuenta_empresaId_mesaId_tipoMesa_fkey")?.definicion).toBe(
      'FOREIGN KEY ("empresaId", "mesaId", "tipoMesa") REFERENCES "Mesa"("empresaId", id, tipo) ON UPDATE RESTRICT ON DELETE RESTRICT',
    );
    expect(f.indices.find((i) => i.nombre === "Mesa_empresaId_id_tipo_key")?.indexdef).toMatch(/^CREATE UNIQUE INDEX .* \("empresaId", id, tipo\)$/);
    expect(f.indices.find((i) => i.nombre === "Cuenta_una_abierta_por_mesa_key"), "el árbitro de «una abierta por mesa» sigue").toBeDefined();
    // Sin políticas, RLS ni privilegios nuevos: lo único que cambia del catálogo son columnas, índices y restricciones.
    expect(f.politicas).toEqual(antesDeM1.politicas);
    expect(f.rls).toEqual(antesDeM1.rls);
    expect(f.privilegios).toEqual(antesDeM1.privilegios);
    expect(f.privilegiosPorColumna).toEqual(antesDeM1.privilegiosPorColumna);
    arribaLaPrimeraVez = f;
  });

  it("3. BAJAR con un puesto mostrador (o una cuenta suya) ABORTA sin tocar nada", async () => {
    await base.cliente.query(`INSERT INTO "Mesa" ("id","empresaId","sucursalId","numero","tipo") VALUES ('mostrador_a',$1,'suc_a',0,'MOSTRADOR')`, [E]);
    await expect(correr("down.sql")).rejects.toThrow(/No se puede bajar 20261027100000_m1_puesto_mostrador: hay 1 puesto\(s\) mostrador y 0 cuenta\(s\)/);
    await base.cliente.query(`INSERT INTO "Cuenta" ("id","empresaId","mesaId","tipoMesa","abiertaPorId") VALUES ('cta_mostrador',$1,'mostrador_a','MOSTRADOR','u_m1')`, [E]);
    await expect(correr("down.sql")).rejects.toThrow(/hay 1 puesto\(s\) mostrador y 1 cuenta\(s\) de mostrador/);
    const f = await foto();
    for (const k of Object.keys(arribaLaPrimeraVez) as (keyof typeof arribaLaPrimeraVez)[]) expect(f[k], `catálogo «${k}» sin cambios tras la reversa abortada`).toEqual(arribaLaPrimeraVez[k]);
    expect(await q(`SELECT id FROM "Cuenta" WHERE "tipoMesa" = 'MOSTRADOR'`), "la cuenta del mostrador sigue").toEqual([{ id: "cta_mostrador" }]);
  });

  it("4. BAJAR sin mostrador: el catálogo queda IDÉNTICO al de antes de M1 (con la FK original, ON UPDATE CASCADE) y las filas siguen", async () => {
    await base.cliente.query(`DELETE FROM "Cuenta" WHERE id = 'cta_mostrador'`);
    await base.cliente.query(`DELETE FROM "Mesa" WHERE id = 'mostrador_a'`);
    await correr("down.sql");
    const f = await foto();
    for (const k of Object.keys(antesDeM1) as (keyof typeof antesDeM1)[]) expect(f[k], `catálogo «${k}» igual que antes de M1`).toEqual(antesDeM1[k]);
    expect(f.restricciones.find((r) => r.nombre === "Cuenta_empresaId_mesaId_fkey")?.definicion).toMatch(/ON UPDATE CASCADE ON DELETE RESTRICT$/);
    expect(await filas(), "las filas de antes siguen idénticas").toEqual(filasAntes);
  });

  it("5. BAJAR DOS VECES no falla (IF EXISTS), y deja el catálogo como estaba", async () => {
    await correr("down.sql");
    await correr("down.sql");
    const f = await foto();
    for (const k of Object.keys(antesDeM1) as (keyof typeof antesDeM1)[]) expect(f[k], `catálogo «${k}» igual que antes de M1`).toEqual(antesDeM1[k]);
  });

  it("6. SUBIR OTRA VEZ: el catálogo es idéntico al de la primera subida y las filas existentes siguen de salón", async () => {
    await correr("migration.sql");
    const f = await foto();
    for (const k of Object.keys(arribaLaPrimeraVez) as (keyof typeof arribaLaPrimeraVez)[]) expect(f[k], `catálogo «${k}» igual que la primera vez`).toEqual(arribaLaPrimeraVez[k]);
    expect(await filas()).toEqual(filasAntes);
    expect(await q(`SELECT DISTINCT tipo FROM "Mesa"`)).toEqual([{ tipo: "SALON" }]);
  });
});
