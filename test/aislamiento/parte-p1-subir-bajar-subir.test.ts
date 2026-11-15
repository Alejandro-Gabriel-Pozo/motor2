import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { digitoVerificadorDeCuit } from "../../src/core/fiscal/cuit-estricto";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";

/**
 * Parte, etapa P1 (docs/diseno-parte-ficha-unica-2026-11-15.md §5): SUBIR, BAJAR y SUBIR de la migración real `20261115120000_parte_ficha_unica_p1` sobre una base TEMPORAL descartable (`crearBaseTemporalMigrada`:
 * solo Postgres local, jamás `motor2_dev`, `motor2_e2e` ni una base real), con su `down.sql` tal cual está en el repo. Parte del estado anterior: todas las migraciones previas aplicadas y proveedores y clientes cargados.
 * Los datos de ejemplo son inventados (el repositorio es público).
 *
 *  1. GUARDA: un proveedor con un nombre que la regla de la ficha no acepta detiene la migración sin dejar nada (y se informan ids, no nombres).
 *  2. SUBIR: relleno SIN pérdida (una ficha por proveedor, conteo antes y después; el dato viejo no se toca; nunca se inventa: CUIT inválido, correo sin forma y notas con invisibles quedan vacíos en la ficha) y "Cliente" intacto.
 *  3. IDEMPOTENCIA del relleno: repetirlo no crea fichas.
 *  4. BAJAR: se NIEGA con una ficha creada desde la app o con una migrada ya editada, salvo confirmación explícita; sin eso baja y el catálogo queda IDÉNTICO al de antes (columnas, índices, restricciones, políticas, RLS, privilegios, funciones).
 *  5. BAJAR DOS VECES no falla; SUBIR OTRA VEZ deja el catálogo idéntico al de la primera subida y el mismo conteo.
 */
const RAIZ = join(__dirname, "../../prisma/migrations");
const P1 = "20261115120000_parte_ficha_unica_p1";
const sql = (archivo: "migration.sql" | "down.sql") => readFileSync(join(RAIZ, P1, archivo), "utf8");

const E1 = "empresa_p1_a";
const E2 = "empresa_p1_b";
let base: BaseTemporalMigrada;

const q = <T extends object = Record<string, unknown>>(texto: string, params: unknown[] = []) => base.cliente.query<T>(texto, params).then((r) => r.rows);
const subir = () => base.cliente.query(sql("migration.sql"));
const bajar = (confirmar = false) => base.cliente.query(confirmar ? `BEGIN; SET LOCAL motor2.confirmar_reversion = 'SI'; ${sql("down.sql")}; COMMIT;` : sql("down.sql"));

/** CUIT válido de 11 dígitos con el prefijo y los 8 dígitos del medio dados (el verificador lo calcula la regla del código). */
function cuit(prefijo: string, medio: string): string {
  const diez = `${prefijo}${medio}`;
  const d = digitoVerificadorDeCuit(diez);
  if (d === null) throw new Error(`sin verificador para ${diez}`);
  return `${diez}${d}`;
}
const CUIT_PERSONA = cuit("20", "12345678");
const CUIT_EMPRESA = cuit("30", "50123456");
const CUIT_PREFIJO_DESCONOCIDO = cuit("55", "11223344");
const CUIT_MALO = `${CUIT_PERSONA.slice(0, 10)}${(Number(CUIT_PERSONA[10]) + 1) % 10}`;

/** Una foto del catálogo de `public` que cubre todo lo que P1 toca: se compara antes de P1, después de bajarla y después de subirla otra vez. */
async function foto() {
  return {
    politicas: await q(`SELECT tablename::text AS tabla, policyname::text AS nombre, roles::text AS roles, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public' ORDER BY 1, 2`),
    columnas: await q(`SELECT table_name::text AS tabla, column_name::text AS columna, data_type, udt_name::text AS udt, is_nullable, column_default, generation_expression FROM information_schema.columns WHERE table_schema = 'public' ORDER BY 1, ordinal_position`),
    indices: await q(`SELECT tablename::text AS tabla, indexname::text AS nombre, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY 1, 2`),
    restricciones: await q(`SELECT conrelid::regclass::text AS tabla, conname::text AS nombre, contype, convalidated, pg_get_constraintdef(oid) AS definicion FROM pg_constraint WHERE connamespace = 'public'::regnamespace ORDER BY 1, 2`),
    rls: await q(`SELECT relname::text AS tabla, relrowsecurity AS rls, relforcerowsecurity AS forzado FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' ORDER BY 1`),
    privilegios: await q(`SELECT table_name::text AS tabla, grantee::text AS rol, privilege_type FROM information_schema.role_table_grants WHERE table_schema = 'public' AND grantee IN ('motor2_app', 'motor2_plataforma') ORDER BY 1, 2, 3`),
    privilegiosPorColumna: await q(`SELECT table_name::text AS tabla, column_name::text AS columna, grantee::text AS rol, privilege_type FROM information_schema.column_privileges WHERE table_schema = 'public' AND grantee IN ('motor2_app', 'motor2_plataforma') AND table_name IN ('Parte', 'Proveedor') ORDER BY 1, 2, 3, 4`),
    funciones: await q(`SELECT proname::text AS nombre, pg_get_function_identity_arguments(oid) AS argumentos FROM pg_proc WHERE pronamespace = 'public'::regnamespace ORDER BY 1, 2`),
    disparadores: await q(`SELECT event_object_table::text AS tabla, trigger_name::text AS nombre FROM information_schema.triggers WHERE trigger_schema = 'public' ORDER BY 1, 2`),
  };
}

/** Las columnas VIEJAS de Proveedor y todo Cliente: P1 no los toca (ni al subir ni al bajar). */
const filasViejas = async () => ({
  proveedores: await q(`SELECT id, "empresaId", codigo, nombre, contacto, telefono, email, cuit, "condicionesPago", notas, activo, "ofreceProductos", "ofreceServicios", "condicionIva" FROM "Proveedor" ORDER BY id`),
  clientes: await q(`SELECT * FROM "Cliente" ORDER BY id`),
});

let antes: Awaited<ReturnType<typeof foto>>;
let filasAntes: Awaited<ReturnType<typeof filasViejas>>;
let arribaLaPrimeraVez: Awaited<ReturnType<typeof foto>>;

const proveedor = (id: string, empresa: string, nombre: string, extra: Record<string, string | null> = {}) => {
  const datos: Record<string, string | null> = { id, empresaId: empresa, codigo: `PRV_${id}`, nombre, ...extra };
  const columnas = Object.keys(datos);
  return base.cliente.query(`INSERT INTO "Proveedor" (${columnas.map((c) => `"${c}"`).join(", ")}) VALUES (${columnas.map((_, i) => `$${i + 1}`).join(", ")})`, Object.values(datos));
};

beforeAll(async () => {
  base = await crearBaseTemporalMigrada();
  await base.aplicarAntesDe(P1);
  const c = base.cliente;
  for (const e of [E1, E2]) await c.query(`INSERT INTO "Empresa" ("id","nombre","slug","zonaHoraria","moneda","estado") VALUES ($1,$1,$1,'America/Argentina/Buenos_Aires','ARS','ACTIVE')`, [e]);
  await proveedor("p_persona", E1, "Panadería Ana", { cuit: CUIT_PERSONA, email: "  ANA@Correo.com ", telefono: " 299 400-0000 ", notas: "Entrega los martes", condicionIva: "MONOTRIBUTO", contacto: "Ana" });
  await proveedor("p_empresa", E1, "Distribuidora Sur SA", { cuit: CUIT_EMPRESA, condicionIva: "RESPONSABLE_INSCRIPTO" });
  await proveedor("p_prefijo", E1, "Importadora Norte", { cuit: CUIT_PREFIJO_DESCONOCIDO });
  await proveedor("p_cuit_malo", E1, "Verdulería Oeste", { cuit: CUIT_MALO });
  await proveedor("p_sin_nada", E1, "Carnicería Este", { email: "sin arroba", telefono: "", notas: "con invisible ‮ dentro" });
  await proveedor("p_otra_empresa", E2, "Panadería Ana", { cuit: CUIT_PERSONA }); // mismo nombre y CUIT que uno de E1: es otra empresa
  await c.query(`INSERT INTO "Cliente" ("id","empresaId","nombre","descuentoPorcentaje") VALUES ('c_1',$1,'Residente',15), ('c_2',$1,'Empleado',25)`, [E1]);
  antes = await foto();
  filasAntes = await filasViejas();
}, 120_000);

afterAll(async () => {
  await base?.eliminar();
}, 60_000);

describe("Parte P1: subir, bajar y subir sobre una base temporal con todo lo anterior aplicado", () => {
  it("0. la migración avisa que requiere autorización expresa y tiene down.sql y verificacion-previa.sql", () => {
    expect(sql("migration.sql").split("\n").slice(0, 2).join(" ")).toContain("REQUIERE AUTORIZACIÓN EXPRESA");
    expect(sql("down.sql").length).toBeGreaterThan(0);
    expect(readFileSync(join(RAIZ, P1, "verificacion-previa.sql"), "utf8")).toContain("READ ONLY");
  });

  it("1. GUARDA: un nombre que la regla de la ficha no acepta detiene la migración sin dejar nada, e informa el id (no el nombre)", async () => {
    await proveedor("p_invalido", E1, "Quesos_del_Sur");
    const error = await subir().then(() => null, (e: Error) => e);
    expect(error?.message).toMatch(/nombre no cumple la regla de la ficha \(ids: p_invalido\)/);
    expect(error?.message).not.toContain("Quesos");
    const f = await foto();
    for (const k of Object.keys(antes) as (keyof typeof antes)[]) expect(f[k], `catálogo «${k}» sin cambios tras la guarda`).toEqual(antes[k]);
    await base.cliente.query(`DELETE FROM "Proveedor" WHERE id = 'p_invalido'`);
  });

  it("2. SUBIR: una ficha por proveedor, sin pérdida y sin inventar datos; lo viejo y Cliente quedan intactos", async () => {
    await subir();
    arribaLaPrimeraVez = await foto();
    expect(await filasViejas(), "ninguna columna vieja ni ningún cliente cambió").toEqual(filasAntes);
    expect(await q(`SELECT count(*)::int AS n FROM "Proveedor" WHERE "parteId" IS NULL`)).toEqual([{ n: 0 }]);
    expect(await q(`SELECT (SELECT count(*)::int FROM "Parte") AS partes, (SELECT count(*)::int FROM "Proveedor") AS proveedores`)).toEqual([{ partes: 6, proveedores: 6 }]);

    const fichas = await q<{ pid: string; naturaleza: string | null; migradaDe: string; nombre: string; documentoTipo: string | null; documentoNumero: string | null; documentoNormalizado: string | null; condicionIva: string | null; email: string | null; telefono: string | null; nota: string | null; estado: string; version: number; creadoPorId: string | null }>(
      `SELECT p.id AS pid, a.naturaleza, a."migradaDe", a.nombre, a."documentoTipo", a."documentoNumero", a."documentoNormalizado", a."condicionIva", a.email, a.telefono, a.nota, a.estado, a.version, a."creadoPorId"
         FROM "Proveedor" p JOIN "Parte" a ON a."empresaId" = p."empresaId" AND a.id = p."parteId" ORDER BY p.id`);
    const por = Object.fromEntries(fichas.map((f) => [f.pid, f]));
    expect(por.p_persona).toMatchObject({ naturaleza: "HUMANA", documentoTipo: "CUIT", documentoNumero: CUIT_PERSONA, documentoNormalizado: `T${CUIT_PERSONA}`, condicionIva: "MONOTRIBUTO", email: "ana@correo.com", telefono: "299 400-0000", nota: "Entrega los martes" });
    expect(por.p_empresa).toMatchObject({ naturaleza: "JURIDICA", documentoTipo: "CUIT", documentoNumero: CUIT_EMPRESA, condicionIva: "RESPONSABLE_INSCRIPTO" });
    expect(por.p_prefijo, "CUIT válido de prefijo desconocido: se guarda el CUIT y la naturaleza queda pendiente").toMatchObject({ naturaleza: null, documentoTipo: "CUIT", documentoNumero: CUIT_PREFIJO_DESCONOCIDO });
    expect(por.p_cuit_malo, "CUIT inválido: la ficha lo deja vacío (el dato viejo sigue en Proveedor)").toMatchObject({ naturaleza: null, documentoTipo: null, documentoNumero: null, documentoNormalizado: null });
    expect(por.p_sin_nada, "correo sin forma, teléfono vacío y nota con invisible: quedan vacíos en la ficha").toMatchObject({ naturaleza: null, email: null, telefono: null, nota: null });
    expect(por.p_otra_empresa).toMatchObject({ naturaleza: "HUMANA", documentoNumero: CUIT_PERSONA });
    for (const f of fichas) expect(f, f.pid).toMatchObject({ migradaDe: "PROVEEDOR", estado: "ACTIVA", version: 1, creadoPorId: null });
    expect(fichas.map((f) => f.nombre)).toEqual((await q<{ nombre: string }>(`SELECT nombre FROM "Proveedor" ORDER BY id`)).map((r) => r.nombre));
  });

  it("3. IDEMPOTENCIA: repetir el relleno no crea fichas ni cambia las que hay", async () => {
    const relleno = sql("migration.sql").slice(sql("migration.sql").indexOf("-- RELLENO sin pérdida"));
    const antesDelRelleno = await q(`SELECT * FROM "Parte" ORDER BY id`);
    await base.cliente.query(relleno);
    expect(await q(`SELECT * FROM "Parte" ORDER BY id`)).toEqual(antesDelRelleno);
  });

  it("4. BAJAR se NIEGA con una ficha creada desde la app, y con una migrada ya editada, salvo confirmación", async () => {
    await base.cliente.query(`INSERT INTO "Parte" (id, "empresaId", "idempotenciaAlta", "payloadHash", naturaleza, nombre) VALUES (gen_random_uuid(), $1, gen_random_uuid(), 'h', 'HUMANA', 'Alta desde la app')`, [E1]);
    await expect(bajar()).rejects.toThrow(/1 ficha\(s\) nueva\(s\)/);
    for (const [k, v] of Object.entries(await foto())) expect(v, `«${k}» sin cambios tras el rechazo`).toEqual(arribaLaPrimeraVez[k as keyof typeof arribaLaPrimeraVez]);
    await base.cliente.query(`DELETE FROM "Parte" WHERE "migradaDe" IS NULL`);

    await base.cliente.query(`UPDATE "Parte" SET alias = 'Anita' WHERE nombre = 'Panadería Ana' AND "empresaId" = $1`, [E1]);
    expect(await q(`SELECT version FROM "Parte" WHERE alias = 'Anita'`)).toEqual([{ version: 2 }]);
    await expect(bajar()).rejects.toThrow(/1 ficha\(s\) migrada\(s\) editada\(s\)/);
    expect((await q(`SELECT count(*)::int AS n FROM "Parte"`))[0]).toEqual({ n: 6 });

    await bajar(true); // con aviso al dueño y respaldo: baja
    expect(await q(`SELECT to_regclass('public."Parte"')::text AS t`)).toEqual([{ t: null }]);
  });

  it("5. SUBIR otra vez rellena de nuevo; BAJAR sin datos nuevos deja el catálogo IDÉNTICO al de antes y lo viejo intacto; BAJAR DOS VECES no falla; SUBIR deja lo mismo que la primera vez", async () => {
    await subir();
    expect(await q(`SELECT count(*)::int AS n FROM "Parte"`)).toEqual([{ n: 6 }]);
    await bajar();
    const abajo = await foto();
    for (const k of Object.keys(antes) as (keyof typeof antes)[]) expect(abajo[k], `catálogo «${k}» idéntico al de antes de P1`).toEqual(antes[k]);
    expect(await filasViejas()).toEqual(filasAntes);
    await bajar(); // idempotente
    await subir();
    const arriba = await foto();
    for (const k of Object.keys(arribaLaPrimeraVez) as (keyof typeof arribaLaPrimeraVez)[]) expect(arriba[k], `catálogo «${k}» idéntico al de la primera subida`).toEqual(arribaLaPrimeraVez[k]);
    expect(await filasViejas()).toEqual(filasAntes);
    expect(await q(`SELECT count(*)::int AS n FROM "Proveedor" WHERE "parteId" IS NULL`)).toEqual([{ n: 0 }]);
  });
});
