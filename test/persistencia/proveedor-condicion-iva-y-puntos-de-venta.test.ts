import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { CONDICIONES_IVA } from "../../src/core/fiscal/iva";
import { EMPRESA_DE_PRUEBA_ID, EMPRESA_TESTIGO_ID, clienteConEmpresaDePrueba, opcionesDeConexionConEmpresa } from "../setup/empresa-de-prueba";
import { baseDeTest, limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";
import { urlDeSembradoDeVitest } from "../setup/rol-de-pruebas";

/**
 * Paquete 3, M3e (migración 20261016104000_proveedor_condicion_iva_y_puntos_de_venta, C36): los datos del proveedor para la factura. `Proveedor.condicionIva` (lista cerrada, la misma que `Empresa.condicionIva`; NULL = no declarada) y la tabla
 * `PuntoDeVentaDeProveedor` (DE EMPRESA, número de 1 a 99999 único por proveedor, `activo`; nunca se borra: se apaga). El subir/bajar/subir de la migración está en `test/aislamiento/m3-factura-proveedor-subir-bajar-subir.test.ts`.
 *
 * Mutación: sacar el CHECK de la condición o del número, el UNIQUE (proveedor, número), la política de empresa, o darle DELETE o UPDATE de más a `motor2_app` deja en rojo solo sus casos. NO hay (a propósito) ninguna función que sugiera la letra de la
 * factura: esas reglas fiscales se verifican contra ARCA antes de ponerlas en código.
 */
afterAll(() => prismaAdmin.$disconnect());

const CARPETA = join(__dirname, "../../prisma/migrations/20261016104000_proveedor_condicion_iva_y_puntos_de_venta");
const abiertos: Client[] = [];
const hayRol = async (rol: string) => ((await prismaAdmin.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM pg_roles WHERE rolname = ${rol}`)[0]!.n) === BigInt(1);
let proveedorId: string;

beforeEach(async () => {
  await limpiarBaseDeTest();
  proveedorId = (await prisma.proveedor.create({ data: { codigo: "PRV_1", nombre: "Distribuidora Sur" } })).id;
});
afterEach(async () => {
  await Promise.all(abiertos.splice(0).map((c) => c.end().catch(() => undefined)));
});

const punto = (numero: number, extra: Record<string, unknown> = {}, id = proveedorId) => prisma.puntoDeVentaDeProveedor.create({ data: { proveedorId: id, numero, ...extra } });

describe("Proveedor.condicionIva", () => {
  it("es TEXT NULLABLE sin default: los proveedores existentes y los nuevos quedan «no declarada»", async () => {
    const col = await prismaAdmin.$queryRaw<Array<{ tipo: string; es_nulable: string; defecto: string | null }>>`
      SELECT data_type AS tipo, is_nullable AS es_nulable, column_default AS defecto FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Proveedor' AND column_name = 'condicionIva'`;
    expect(col).toEqual([{ tipo: "text", es_nulable: "YES", defecto: null }]);
    expect((await prisma.proveedor.findUniqueOrThrow({ where: { id: proveedorId } })).condicionIva).toBeNull();
  });

  it("acepta las tres condiciones y NULL; un código inventado, en minúsculas o vacío da 23514 (Proveedor_condicionIva_check)", async () => {
    let i = 0;
    for (const c of CONDICIONES_IVA) expect((await prisma.proveedor.create({ data: { codigo: `P${++i}`, nombre: `Prov ${i}`, condicionIva: c } })).condicionIva).toBe(c);
    for (const mala of ["RI", "monotributo", "", "NO_ALCANZADO", "RESPONSABLE_INSCRIPTO "]) {
      await expect(prisma.proveedor.create({ data: { codigo: `X${++i}`, nombre: `Malo ${i}`, condicionIva: mala } }), `«${mala}»`).rejects.toThrow(/Proveedor_condicionIva_check/);
    }
    await expect(prismaAdmin.$executeRawUnsafe(`UPDATE "Proveedor" SET "condicionIva" = 'RI' WHERE id = '${proveedorId}'`)).rejects.toThrow(/Proveedor_condicionIva_check/);
  });

  it("PARIDAD: la lista del CHECK es EXACTAMENTE CONDICIONES_IVA de src/core/fiscal/iva.ts (la misma que la de la empresa)", async () => {
    const lista = async (tabla: string, nombre: string) => {
      const [f] = await prismaAdmin.$queryRawUnsafe<Array<{ def: string }>>(`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = '"${tabla}"'::regclass AND conname = '${nombre}'`);
      return [...f!.def.matchAll(/'([^']+)'::text/g)].map((m) => m[1]!).sort();
    };
    expect(await lista("Proveedor", "Proveedor_condicionIva_check")).toEqual([...CONDICIONES_IVA].sort());
    expect(await lista("Proveedor", "Proveedor_condicionIva_check")).toEqual(await lista("Empresa", "Empresa_condicionIva_check"));
  });

  it("no hay obligatoriedad: se puede actualizar un proveedor sin mencionar la condición, y no hay restricciones sin validar", async () => {
    await prisma.proveedor.update({ where: { id: proveedorId }, data: { nombre: "Otro nombre" } });
    expect(await prismaAdmin.$queryRaw`SELECT conname FROM pg_constraint WHERE conrelid = '"Proveedor"'::regclass AND NOT convalidated`).toEqual([]);
  });
});

describe("PuntoDeVentaDeProveedor: estructura y reglas", () => {
  it("las columnas, los índices únicos, las claves foráneas (compuesta RESTRICT) y la RLS por empresa están puestos", async () => {
    const col = await prismaAdmin.$queryRaw<Array<{ columna: string; tipo: string; es_nulable: string; defecto: string | null }>>`
      SELECT column_name::text AS columna, data_type AS tipo, is_nullable AS es_nulable, column_default AS defecto FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'PuntoDeVentaDeProveedor' ORDER BY ordinal_position`;
    expect(col.map((c) => `${c.columna}:${c.tipo}:${c.es_nulable}`)).toEqual(["id:text:NO", "empresaId:text:NO", "proveedorId:text:NO", "numero:integer:NO", "activo:boolean:NO", "creadoEn:timestamp without time zone:NO"]);
    expect(col.find((c) => c.columna === "activo")!.defecto).toBe("true");
    const unicos = await prismaAdmin.$queryRaw<Array<{ nombre: string }>>`SELECT ic.relname::text AS nombre FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid WHERE i.indrelid = '"PuntoDeVentaDeProveedor"'::regclass AND i.indisunique AND NOT i.indisprimary ORDER BY 1`;
    expect(unicos.map((u) => u.nombre)).toEqual(["PuntoDeVentaDeProveedor_empresaId_id_key", "PuntoDeVentaDeProveedor_proveedorId_numero_key"]);
    const fks = await prismaAdmin.$queryRaw<Array<{ conname: string; d: string }>>`SELECT conname::text AS conname, pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE contype = 'f' AND conrelid = '"PuntoDeVentaDeProveedor"'::regclass ORDER BY 1`;
    expect(fks.map((f) => f.conname)).toEqual(["PuntoDeVentaDeProveedor_empresaId_fkey", "PuntoDeVentaDeProveedor_empresaId_proveedorId_fkey"]);
    for (const f of fks) expect(f.d, f.conname).toMatch(/ON DELETE RESTRICT/);
    expect(fks[1]!.d).toMatch(/FOREIGN KEY \("empresaId", "proveedorId"\) REFERENCES "Proveedor"\("empresaId", id\)/);
    const rls = await prismaAdmin.$queryRaw<Array<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>>`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = '"PuntoDeVentaDeProveedor"'::regclass`;
    expect(rls).toEqual([{ relrowsecurity: true, relforcerowsecurity: false }]);
    const pol = await prismaAdmin.$queryRaw<Array<{ policyname: string }>>`SELECT policyname::text AS policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'PuntoDeVentaDeProveedor'`;
    expect(pol.map((p) => p.policyname)).toEqual(["aislamiento_empresa"]);
  });

  it("el número va de 1 a 99999 (PuntoDeVentaDeProveedor_numero_chk): 1 y 99999 entran; 0, 100000 y negativos no", async () => {
    expect((await punto(1)).numero).toBe(1);
    expect((await punto(99999)).numero).toBe(99999);
    for (const n of [0, 100000, -5]) await expect(punto(n), String(n)).rejects.toThrow(/PuntoDeVentaDeProveedor_numero_chk/);
  });

  it("nace activo; el número es único por proveedor (dos proveedores pueden tener el mismo punto)", async () => {
    expect((await punto(7)).activo).toBe(true);
    await expect(punto(7)).rejects.toMatchObject({ code: "P2002" });
    const otro = (await prisma.proveedor.create({ data: { codigo: "PRV_2", nombre: "Otro" } })).id;
    expect((await punto(7, {}, otro)).numero).toBe(7);
  });

  it("CONCURRENCIA: el mismo punto cargado a la vez para el mismo proveedor deja UNO (23505)", async () => {
    const resultados = await Promise.all([0, 1, 2, 3, 4, 5].map(() => punto(12).then(() => "ok" as const, (e: { code?: string }) => e.code ?? "otro")));
    expect(resultados.filter((r) => r === "ok")).toHaveLength(1);
    expect(resultados.filter((r) => r === "P2002")).toHaveLength(5);
    expect(await prismaAdmin.puntoDeVentaDeProveedor.count({ where: { numero: 12 } })).toBe(1);
  });

  it("el proveedor tiene que existir y ser de la misma empresa (clave foránea compuesta); un proveedor con puntos no se borra (RESTRICT)", async () => {
    await expect(punto(1, {}, "no-existe")).rejects.toThrow(/PuntoDeVentaDeProveedor_empresaId_proveedorId_fkey/);
    const testigo = clienteConEmpresaDePrueba(urlDeSembradoDeVitest(), EMPRESA_TESTIGO_ID);
    const ajeno = await testigo.proveedor.create({ data: { codigo: "PRV_T", nombre: "Proveedor testigo" } });
    await expect(punto(1, {}, ajeno.id)).rejects.toThrow(/PuntoDeVentaDeProveedor_empresaId_proveedorId_fkey/);
    await punto(3);
    await expect(prismaAdmin.$executeRawUnsafe(`DELETE FROM "Proveedor" WHERE id = '${proveedorId}'`)).rejects.toThrow(/PuntoDeVentaDeProveedor_empresaId_proveedorId_fkey/);
  });

  it("RLS: la empresa A no ve los puntos de venta de los proveedores de la B", async () => {
    const testigo = clienteConEmpresaDePrueba(urlDeSembradoDeVitest(), EMPRESA_TESTIGO_ID);
    const ajeno = await testigo.proveedor.create({ data: { codigo: "PRV_T", nombre: "Proveedor testigo" } });
    await testigo.puntoDeVentaDeProveedor.create({ data: { proveedorId: ajeno.id, numero: 4 } });
    const mio = await punto(4);
    expect((await prisma.puntoDeVentaDeProveedor.findMany()).map((p) => p.id)).toEqual([mio.id]);
    expect(await prismaAdmin.puntoDeVentaDeProveedor.count()).toBe(2);
  });
});

describe("PuntoDeVentaDeProveedor: nunca se borra, solo se apaga", () => {
  it("motor2_app: SELECT, INSERT y UPDATE solo de `activo`; nada de DELETE; motor2_plataforma, nada (a nivel base)", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const tabla = await prismaAdmin.$queryRaw<Array<{ rol: string; privilegio: string }>>`
      SELECT grantee::text AS rol, privilege_type AS privilegio FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'PuntoDeVentaDeProveedor' AND grantee IN ('motor2_app', 'motor2_plataforma') ORDER BY 1, 2`;
    expect(tabla).toEqual([{ rol: "motor2_app", privilegio: "INSERT" }, { rol: "motor2_app", privilegio: "SELECT" }]);
    const cols = await prismaAdmin.$queryRaw<Array<{ columna: string }>>`
      SELECT a.attname::text AS columna FROM pg_attribute a WHERE a.attrelid = '"PuntoDeVentaDeProveedor"'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('motor2_app', a.attrelid, a.attnum, 'UPDATE') ORDER BY 1`;
    expect(cols.map((c) => c.columna)).toEqual(["activo"]);
    const plataforma = await prismaAdmin.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM information_schema.column_privileges WHERE table_schema = 'public' AND table_name = 'PuntoDeVentaDeProveedor' AND grantee = 'motor2_plataforma'`;
    expect(Number(plataforma[0]!.n)).toBe(0);
  });

  it("como motor2_app: se agrega, se lee y se apaga; no se borra ni se corrige el número", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const db = baseDeTest.db;
    const p = await db.puntoDeVentaDeProveedor.create({ data: { proveedorId, numero: 21 } });
    expect((await db.puntoDeVentaDeProveedor.findUniqueOrThrow({ where: { id: p.id } })).activo).toBe(true);
    expect((await db.puntoDeVentaDeProveedor.update({ where: { id: p.id }, data: { activo: false } })).activo).toBe(false);
    expect((await db.puntoDeVentaDeProveedor.update({ where: { id: p.id }, data: { activo: true } })).activo).toBe(true);
    await expect(db.puntoDeVentaDeProveedor.update({ where: { id: p.id }, data: { numero: 22 } })).rejects.toThrow(/permission denied/i);
    await expect(db.puntoDeVentaDeProveedor.delete({ where: { id: p.id } })).rejects.toThrow(/permission denied/i);
    await expect(db.puntoDeVentaDeProveedor.deleteMany()).rejects.toThrow(/permission denied/i);
    expect((await prismaAdmin.puntoDeVentaDeProveedor.findUniqueOrThrow({ where: { id: p.id } })).numero).toBe(21);
  });

  it("por el rol crudo: DELETE da 42501 y UPDATE del número da 42501", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const p = await punto(31);
    const c = new Client({ connectionString: process.env.DATABASE_URL as string, options: opcionesDeConexionConEmpresa(EMPRESA_DE_PRUEBA_ID) });
    abiertos.push(c);
    await c.connect();
    await expect(c.query(`DELETE FROM "PuntoDeVentaDeProveedor" WHERE id = $1`, [p.id])).rejects.toMatchObject({ code: "42501" });
    await expect(c.query(`UPDATE "PuntoDeVentaDeProveedor" SET "numero" = 32 WHERE id = $1`, [p.id])).rejects.toMatchObject({ code: "42501" });
    await c.query(`UPDATE "PuntoDeVentaDeProveedor" SET "activo" = false WHERE id = $1`, [p.id]);
    await expect(c.query(`INSERT INTO "PuntoDeVentaDeProveedor" ("id","empresaId","proveedorId","numero") VALUES ($1,$2,$3,40)`, [randomUUID(), EMPRESA_TESTIGO_ID, proveedorId])).rejects.toMatchObject({ code: "42501" });
  });
});

describe("la migración", () => {
  it("avisa que requiere autorización, que la reversa puede perder datos y qué saca; y NO trae ninguna regla de la letra de la factura", () => {
    const m = readFileSync(join(CARPETA, "migration.sql"), "utf8");
    expect(m.split("\n")[0]).toContain("REQUIERE AUTORIZACIÓN EXPRESA");
    const d = readFileSync(join(CARPETA, "down.sql"), "utf8");
    expect(d).toMatch(/DESTRUCTIVA/);
    for (const n of ["PuntoDeVentaDeProveedor", "Proveedor_condicionIva_check", "condicionIva"]) expect(d, n).toContain(n);
    expect(m.replace(/--.*$/gm, ""), "ninguna función ni sentencia de letras en la migración").not.toMatch(/CREATE (OR REPLACE )?FUNCTION|letra/i);
  });
});
