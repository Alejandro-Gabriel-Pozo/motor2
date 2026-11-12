import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";

/**
 * Paso 10 (checks de datos básicos): SUBIR, BAJAR y SUBIR de la migración real `20261112160000_checks_de_datos_basicos` sobre una base TEMPORAL descartable (`crearBaseTemporalMigrada`: solo Postgres local, jamás una base
 * real), con su `down.sql` tal cual está en el repo. La aplicación a bases reales NO sale de esta rama: la hace la coordinación con respaldo y ensayo.
 *
 * Qué comprueba:
 *  0. La migración existe, avisa que requiere autorización y tiene down.sql.
 *  1. SUBIR: los tres CHECK existen y están VALIDADOS (`convalidated`); rechazan el caso inválido (23514) y dejan pasar el válido (altas de empresa, cotización y cliente); las filas sembradas antes no cambian; no cambia
 *     nada más del catálogo (tablas, columnas, índices, políticas, privilegios): la única diferencia son los tres CHECK.
 *  2. BAJAR: los tres CHECK ya no existen, los datos siguen intactos, el catálogo queda IDÉNTICO al de antes y los casos inválidos vuelven a entrar (como antes de la migración). Bajar dos veces no falla.
 *  3. SUBIR otra vez: el catálogo queda idéntico al de la primera subida. Subir con una fila inválida ABORTA entero sin dejar ningún CHECK a medias.
 *
 * Mutación (anotada en el commit): sacar un CHECK del down.sql → rojo el caso 2; sacar el VALIDATE de la migración → rojo el caso 1 (`convalidated` falso).
 */
const RAIZ = join(__dirname, "../../prisma/migrations");
const MIGRACION = "20261112160000_checks_de_datos_basicos";
const sql = (archivo: "migration.sql" | "down.sql") => readFileSync(join(RAIZ, MIGRACION, archivo), "utf8");
const CHECKS = ["Cliente_descuentoPorcentaje_chk", "CotizacionDolar_fuente_chk", "Empresa_moneda_chk"];

const E = "empresa_p10";
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
  };
}
type Foto = Awaited<ReturnType<typeof foto>>;
const sinLosChecks = (f: Foto) => ({ ...f, restricciones: f.restricciones.filter((r) => !CHECKS.includes(r.nombre as string)) });
const checksDe = (f: Foto) => f.restricciones.filter((r) => CHECKS.includes(r.nombre as string));
const datos = async () => ({
  empresas: await q(`SELECT * FROM "Empresa" ORDER BY id`),
  cotizaciones: await q(`SELECT * FROM "CotizacionDolar" ORDER BY id`),
  clientes: await q(`SELECT * FROM "Cliente" ORDER BY id`),
});

/** Devuelve el nombre del CHECK violado, `null` si la sentencia entró. */
async function resultado(texto: string, params: unknown[] = []): Promise<string | null> {
  try {
    await base.cliente.query(texto, params);
    return null;
  } catch (e) {
    const m = /violates check constraint "([^"]+)"/.exec((e as Error).message);
    return m ? m[1]! : `otro error: ${(e as Error).message}`;
  }
}
const altaEmpresa = (id: string, moneda: string) => resultado(`INSERT INTO "Empresa" ("id","nombre","slug","zonaHoraria","moneda","estado") VALUES ($1,$1,$1,'America/Argentina/Buenos_Aires',$2,'ACTIVE')`, [id, moneda]);
const altaCotizacion = (id: string, fuente: string) => resultado(`INSERT INTO "CotizacionDolar" ("id","fecha","fuente","venta") VALUES ($1,'2026-11-12',$2,1500)`, [id, fuente]);
const altaCliente = (id: string, descuento: string) => resultado(`INSERT INTO "Cliente" ("id","empresaId","nombre","descuentoPorcentaje") VALUES ($1,$2,$1,$3::numeric)`, [id, E, descuento]);
const borrarPruebas = async () => {
  await q(`DELETE FROM "Cliente" WHERE id LIKE 'x_%'`);
  await q(`DELETE FROM "CotizacionDolar" WHERE id LIKE 'x_%'`);
  await q(`DELETE FROM "Empresa" WHERE id LIKE 'x_%'`);
};

let antes: Foto;
let arriba: Foto;
let datosSembrados: Awaited<ReturnType<typeof datos>>;

beforeAll(async () => {
  base = await crearBaseTemporalMigrada();
  await base.aplicarAntesDe(MIGRACION);
  await q(`INSERT INTO "Empresa" ("id","nombre","slug","zonaHoraria","moneda","estado") VALUES ($1,$1,$1,'America/Argentina/Buenos_Aires','ARS','ACTIVE')`, [E]);
  await q(`INSERT INTO "CotizacionDolar" ("id","fecha","fuente","venta") VALUES ('cot_bna','2026-11-10','BNA',1400), ('cot_bcra','2026-11-11','BCRA',1410)`);
  await q(`INSERT INTO "Cliente" ("id","empresaId","nombre","descuentoPorcentaje") VALUES ('c_0',$1,'Cero',0), ('c_max',$1,'Casi cien',99.99)`, [E]);
  antes = await foto();
  datosSembrados = await datos();
}, 180_000);

afterAll(async () => {
  await base?.eliminar();
}, 60_000);

const correr = (archivo: "migration.sql" | "down.sql") => base.cliente.query(sql(archivo));

describe("Paso 10, checks de datos básicos: subir, bajar y subir sobre una base temporal con todo lo anterior aplicado", () => {
  it("0. la migración existe, avisa la autorización y tiene down.sql", () => {
    expect(readdirSync(RAIZ)).toContain(MIGRACION);
    expect(sql("migration.sql").split("\n").slice(0, 3).join("\n")).toContain("REQUIERE AUTORIZACIÓN EXPRESA");
    expect(sql("down.sql").length).toBeGreaterThan(0);
  });

  it("antes de subir: no hay ningún CHECK y los casos inválidos entran (es lo que la migración viene a cerrar)", async () => {
    expect(checksDe(antes)).toEqual([]);
    expect(await altaEmpresa("x_minus", "ars")).toBeNull();
    expect(await altaCotizacion("x_otra", "OTRA")).toBeNull();
    expect(await altaCliente("x_cien", "100")).toBeNull();
    await borrarPruebas();
    expect(await datos()).toEqual(datosSembrados);
  });

  it("1. SUBIR: tres CHECK validados, rechazan lo inválido y dejan pasar lo válido; las filas previas y el resto del catálogo no cambian", async () => {
    await correr("migration.sql");
    const f = await foto();
    // Lo ÚNICO que cambia respecto de antes: los tres CHECK.
    expect(sinLosChecks(f)).toEqual(sinLosChecks(antes));
    const checks = checksDe(f);
    expect(checks.map((c) => c.nombre)).toEqual(CHECKS);
    expect(checks.map((c) => [c.contype, c.convalidated]), "los tres son CHECK y están validados").toEqual(CHECKS.map(() => ["c", true]));
    expect(checks.find((c) => c.nombre === "Empresa_moneda_chk")?.definicion).toContain("[A-Z]{3}");
    expect(checks.find((c) => c.nombre === "CotizacionDolar_fuente_chk")?.definicion).toMatch(/BNA.*BCRA/);
    expect(checks.find((c) => c.nombre === "Cliente_descuentoPorcentaje_chk")?.definicion).toMatch(/>= \(0\).*< \(100\)/);

    // Lo inválido se rechaza con el nombre del CHECK.
    expect(await altaEmpresa("x_minus", "ars")).toBe("Empresa_moneda_chk");
    expect(await altaEmpresa("x_largo", "ARSS")).toBe("Empresa_moneda_chk");
    expect(await altaCotizacion("x_otra", "OTRA")).toBe("CotizacionDolar_fuente_chk");
    expect(await altaCliente("x_neg", "-0.01")).toBe("Cliente_descuentoPorcentaje_chk");
    expect(await altaCliente("x_cien", "100")).toBe("Cliente_descuentoPorcentaje_chk");
    // Lo válido sigue pasando (las altas de siempre).
    expect(await altaEmpresa("x_usd", "USD")).toBeNull();
    expect(await altaCotizacion("x_bna", "BNA")).toBeNull();
    expect(await altaCotizacion("x_bcra", "BCRA")).toBeNull();
    expect(await altaCliente("x_cero", "0")).toBeNull();
    expect(await altaCliente("x_max", "99.99")).toBeNull();
    await borrarPruebas();
    expect(await datos(), "las filas de antes no cambiaron").toEqual(datosSembrados);
    arriba = f;
  });

  it("2. BAJAR: los CHECK desaparecen, los datos quedan intactos, el catálogo es idéntico al de antes y lo inválido vuelve a entrar; bajar dos veces no falla", async () => {
    await correr("down.sql");
    expect(await foto(), "tras bajar, el catálogo es idéntico al de antes de la migración").toEqual(antes);
    expect(checksDe(await foto())).toEqual([]);
    expect(await datos(), "bajar no toca ningún dato").toEqual(datosSembrados);
    expect(await altaEmpresa("x_minus", "ars")).toBeNull();
    expect(await altaCotizacion("x_otra", "OTRA")).toBeNull();
    expect(await altaCliente("x_cien", "100")).toBeNull();
    await borrarPruebas();
    // Idempotente: repetir el down no falla y no cambia nada.
    await correr("down.sql");
    await correr("down.sql");
    expect(await foto()).toEqual(antes);
    expect(await datos()).toEqual(datosSembrados);
  });

  it("3. SUBIR otra vez deja el catálogo idéntico al de la primera subida", async () => {
    await correr("migration.sql");
    expect(await foto()).toEqual(arriba);
    expect(await altaEmpresa("x_minus", "ars")).toBe("Empresa_moneda_chk");
    expect(await datos()).toEqual(datosSembrados);
    // Y se puede bajar de nuevo desde acá.
    await correr("down.sql");
    expect(await foto()).toEqual(antes);
  });

  it("4. con una fila inválida ya guardada, subir ABORTA entero (una transacción) y no deja ningún CHECK a medias", async () => {
    // Estado de antes (sin CHECK): se guarda un descuento fuera de rango y una moneda en minúsculas.
    expect(await altaCliente("x_viejo", "150")).toBeNull();
    let error: unknown = null;
    try {
      await base.cliente.query(`BEGIN`);
      await base.cliente.query(sql("migration.sql"));
      await base.cliente.query(`COMMIT`);
    } catch (e) {
      error = e;
      await base.cliente.query(`ROLLBACK`);
    }
    expect(String((error as Error)?.message)).toMatch(/Cliente_descuentoPorcentaje_chk/);
    expect(await foto(), "la subida abortada no dejó nada a medias").toEqual(antes);
    await q(`DELETE FROM "Cliente" WHERE id = 'x_viejo'`);
    await correr("migration.sql");
    expect(await foto()).toEqual(arriba);
  });
});
