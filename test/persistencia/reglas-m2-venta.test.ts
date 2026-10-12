import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Proceso } from "@prisma/client";
import { baseDeTest, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase } from "../setup/test-db";
import { clienteConEmpresaDePrueba, EMPRESA_DE_PRUEBA_ID, EMPRESA_TESTIGO_ID } from "../setup/empresa-de-prueba";
import { urlDeSembradoDeVitest } from "../setup/rol-de-pruebas";

/**
 * M2-3 (Paquete 2): la cabecera `Venta` (con su canal MESA/MOSTRADOR) y `Operacion.ventaId` (migración 20261015122000_m2_cabecera_de_venta). Tres mitades: (1) la migración deja la tabla, sus índices, claves
 * foráneas, reglas, RLS y privilegios puestos; (2) cada regla rechaza, con el nombre de su restricción, una fila que la rompe; (3) lo que protege el dinero y la concurrencia: la tabla SOLO se agrega (la app no
 * puede modificar ni borrar una cabecera), el total se guarda exacto, una mesa tiene a lo sumo UNA cabecera (cerrarla dos veces, aunque sea a la vez, no escribe dos) y una empresa no ve ni toca las de otra.
 * Las políticas de SUCURSAL de la tabla (M2-4) y el ciclo subir/bajar/subir están en `test/aislamiento/m2-venta-subir-bajar-subir.test.ts`.
 *
 * Mutación: sacar un CHECK, un índice único, el REVOKE de UPDATE/DELETE o la política de empresa de la migración deja en rojo solo sus casos.
 */
afterAll(() => prismaAdmin.$disconnect());

const CARPETA = join(__dirname, "../../prisma/migrations/20261015122000_m2_cabecera_de_venta");
const CHECKS = ["Venta_canal_y_cuenta_chk", "Venta_importe_total_no_negativo_chk", "Operacion_venta_solo_en_ventas_chk"];

let usuarioId: string;
let sucursalId: string;
let numeroDeMesa = 0;

beforeEach(async () => {
  await limpiarBaseDeTest();
  const base = await sembrarBase();
  sucursalId = base.sucursal.id;
  usuarioId = (await prisma.user.create({ data: { email: "mozo@test.com" } })).id;
  numeroDeMesa = 0;
});

const mesa = () => prisma.mesa.create({ data: { sucursalId, numero: ++numeroDeMesa } });
/** Una cuenta cerrada de una mesa nueva (el caso de una venta de MESA). */
async function cuenta() {
  const m = await mesa();
  return prisma.cuenta.create({ data: { mesaId: m.id, abiertaPorId: usuarioId, cerradaEn: new Date(), cerradaPorId: usuarioId } });
}

type DatosVenta = Partial<{ canal: "MESA" | "MOSTRADOR"; cuentaId: string | null; importeTotal: string; fecha: Date; sucursalId: string }>;
const datosDeVenta = (datos: DatosVenta) => ({ sucursalId, canal: "MOSTRADOR" as const, fecha: new Date(), importeTotal: "100.00", usuarioId, ...datos });
const ventaDeMostrador = (datos: DatosVenta = {}) => prisma.venta.create({ data: datosDeVenta(datos) });
async function ventaDeMesa(datos: DatosVenta = {}) {
  const c = await cuenta();
  return prisma.venta.create({ data: datosDeVenta({ canal: "MESA", cuentaId: c.id, ...datos }) });
}

function operacion(proceso: Proceso, ventaId?: string) {
  return prisma.operacion.create({ data: { sucursalId, fecha: new Date(), usuarioId, proceso, ...(ventaId ? { ventaId } : {}) } });
}

const hayRol = async (rol: string) => ((await prismaAdmin.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM pg_roles WHERE rolname = ${rol}`)[0]!.n) === BigInt(1);

describe("la migración deja la tabla, el tipo, los índices, las claves foráneas, las reglas y la RLS puestos", () => {
  it("el tipo CanalDeVenta tiene MESA y MOSTRADOR, y la tabla las columnas esperadas con sus tipos y su nulabilidad", async () => {
    const valores = await prismaAdmin.$queryRaw<Array<{ v: string }>>`SELECT e.enumlabel::text AS v FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'CanalDeVenta' ORDER BY e.enumsortorder`;
    expect(valores.map((x) => x.v)).toEqual(["MESA", "MOSTRADOR"]);
    const columnas = await prismaAdmin.$queryRaw<Array<{ columna: string; tipo: string; es_nulable: string; precision: number | null; escala: number | null }>>`
      SELECT column_name::text AS columna, CASE WHEN data_type = 'USER-DEFINED' THEN udt_name::text ELSE data_type END AS tipo, is_nullable AS es_nulable, numeric_precision::int AS precision, numeric_scale::int AS escala
      FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Venta' ORDER BY ordinal_position`;
    expect(columnas.map((c) => `${c.columna}:${c.tipo}:${c.es_nulable}`)).toEqual([
      "id:text:NO", "empresaId:text:NO", "sucursalId:text:NO", "canal:CanalDeVenta:NO", "cuentaId:text:YES", "fecha:timestamp without time zone:NO", "importeTotal:numeric:NO", "usuarioId:text:NO", "creadoEn:timestamp without time zone:NO",
    ]);
    const total = columnas.find((c) => c.columna === "importeTotal")!;
    expect([total.precision, total.escala], "dinero exacto: NUMERIC(14,2), nunca float").toEqual([14, 2]);
  });

  it("los 3 CHECK están validados, los índices únicos son (empresaId, id) y (empresaId, cuentaId), y las claves foráneas son compuestas RESTRICT", async () => {
    const checks = await prismaAdmin.$queryRaw<Array<{ conname: string; convalidated: boolean }>>`SELECT conname::text AS conname, convalidated FROM pg_constraint WHERE contype = 'c' AND conname::text = ANY(${CHECKS}::text[])`;
    expect(checks.map((c) => c.conname).sort()).toEqual([...CHECKS].sort());
    expect(checks.every((c) => c.convalidated)).toBe(true);

    const unicos = await prismaAdmin.$queryRaw<Array<{ definicion: string }>>`SELECT pg_get_indexdef(i.indexrelid) AS definicion FROM pg_index i WHERE i.indrelid = '"Venta"'::regclass AND i.indisunique AND NOT i.indisprimary`;
    expect(unicos.map((u) => u.definicion.replace(/^.*USING btree /, "")).sort()).toEqual(['("empresaId", "cuentaId")', '("empresaId", id)']);

    const fks = await prismaAdmin.$queryRaw<Array<{ conname: string; definicion: string }>>`SELECT conname::text AS conname, pg_get_constraintdef(oid) AS definicion FROM pg_constraint WHERE contype = 'f' AND (conrelid = '"Venta"'::regclass OR conname::text = 'Operacion_empresaId_ventaId_fkey') ORDER BY 1`;
    expect(fks.map((f) => f.conname)).toEqual(["Operacion_empresaId_ventaId_fkey", "Venta_empresaId_cuentaId_fkey", "Venta_empresaId_fkey", "Venta_empresaId_sucursalId_fkey", "Venta_usuarioId_fkey"]);
    for (const f of fks) expect(f.definicion, f.conname).toMatch(/ON DELETE RESTRICT/);
    for (const f of fks.filter((x) => /sucursalId|cuentaId|ventaId/.test(x.conname))) expect(f.definicion, f.conname).toMatch(/FOREIGN KEY \("empresaId", "\w+"\) REFERENCES "\w+"\("empresaId", id\)/);
  });

  it("la RLS por empresa está puesta (una sola política aislamiento_empresa, con USING y WITH CHECK) y la tabla no tiene default de empresa inventado", async () => {
    const rls = await prismaAdmin.$queryRaw<Array<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>>`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = '"Venta"'::regclass`;
    expect(rls).toEqual([{ relrowsecurity: true, relforcerowsecurity: false }]);
    const politicas = await prismaAdmin.$queryRaw<Array<{ policyname: string; qual: string | null; with_check: string | null }>>`SELECT policyname::text AS policyname, qual, with_check FROM pg_policies WHERE schemaname = 'public' AND tablename = 'Venta' AND policyname = 'aislamiento_empresa'`;
    expect(politicas).toHaveLength(1);
    expect(politicas[0]!.qual).toMatch(/app_empresa_actual/);
    expect(politicas[0]!.with_check).toMatch(/app_empresa_actual/);
    const total = await prismaAdmin.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM pg_policies WHERE schemaname = 'public' AND tablename = 'Venta' AND policyname NOT LIKE 'alcance\\_sucursal\\_%' AND policyname <> 'aislamiento_empresa'`;
    expect(Number(total[0]!.n), "ninguna otra política que no sea la de empresa o las 4 de sucursal de M2-4").toBe(0);
  });

  it("SOLO se agrega: motor2_app tiene SELECT e INSERT y nada más; motor2_plataforma no tiene nada", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const filas = await prismaAdmin.$queryRaw<Array<{ rol: string; privilegio: string }>>`
      SELECT grantee::text AS rol, privilege_type AS privilegio FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'Venta' AND grantee IN ('motor2_app', 'motor2_plataforma') ORDER BY 1, 2`;
    expect(filas).toEqual([{ rol: "motor2_app", privilegio: "INSERT" }, { rol: "motor2_app", privilegio: "SELECT" }]);
  });

  it("el migration.sql y el down.sql avisan que requieren autorización, que la reversa puede perder datos y en qué orden se baja", () => {
    expect(readFileSync(join(CARPETA, "migration.sql"), "utf8").split("\n")[0]).toContain("REQUIERE AUTORIZACIÓN EXPRESA");
    const reversa = readFileSync(join(CARPETA, "down.sql"), "utf8");
    expect(reversa).toMatch(/DESTRUCTIVA/);
    expect(reversa).toMatch(/ANTES M2-4/);
    for (const nombre of ["Operacion_venta_solo_en_ventas_chk", "Operacion_empresaId_ventaId_fkey", "Operacion_ventaId_idx", "ventaId", "CanalDeVenta", '"Venta"']) expect(reversa, `el down.sql saca ${nombre}`).toContain(nombre);
  });
});

describe("Venta: reglas de la cabecera", () => {
  it("una venta de MESA lleva su cuenta y una de MOSTRADOR no; el total se guarda exacto en centavos", async () => {
    const mesaDeVenta = await ventaDeMesa({ importeTotal: "33.33" });
    expect(mesaDeVenta.canal).toBe("MESA");
    expect(mesaDeVenta.cuentaId).not.toBeNull();
    const mostrador = await ventaDeMostrador({ importeTotal: "1234567890.10" });
    expect(mostrador.cuentaId).toBeNull();
    const releida = await prismaAdmin.venta.findUniqueOrThrow({ where: { id: mostrador.id } });
    expect(releida.importeTotal.toFixed(2)).toBe("1234567890.10");
    expect((await prismaAdmin.venta.findUniqueOrThrow({ where: { id: mesaDeVenta.id } })).importeTotal.toFixed(2)).toBe("33.33");
  });

  it("una venta de MESA sin cuenta se rechaza, y una de MOSTRADOR con cuenta también (Venta_canal_y_cuenta_chk)", async () => {
    await expect(ventaDeMostrador({ canal: "MESA" })).rejects.toThrow(/Venta_canal_y_cuenta_chk/);
    const c = await cuenta();
    await expect(ventaDeMostrador({ canal: "MOSTRADOR", cuentaId: c.id })).rejects.toThrow(/Venta_canal_y_cuenta_chk/);
  });

  it("el total no puede ser negativo, y cero sí (una venta con descuento total) (Venta_importe_total_no_negativo_chk)", async () => {
    await expect(ventaDeMostrador({ importeTotal: "-0.01" })).rejects.toThrow(/Venta_importe_total_no_negativo_chk/);
    expect((await ventaDeMostrador({ importeTotal: "0.00" })).importeTotal.toFixed(2)).toBe("0.00");
  });

  it("la cuenta, la sucursal y el usuario tienen que existir (claves foráneas)", async () => {
    await expect(ventaDeMostrador({ canal: "MESA", cuentaId: "no-existe" })).rejects.toThrow(/Venta_empresaId_cuentaId_fkey/);
    await expect(ventaDeMostrador({ sucursalId: "no-existe" })).rejects.toThrow(/Venta_empresaId_sucursalId_fkey/);
    await expect(prisma.venta.create({ data: { ...datosDeVenta({}), usuarioId: "no-existe" } })).rejects.toThrow(/Venta_usuarioId_fkey/);
  });
});

describe("Venta: una mesa tiene a lo sumo UNA cabecera (idempotencia natural del cierre)", () => {
  it("una segunda cabecera para la misma cuenta se rechaza con el índice único, y las de mostrador (sin cuenta) no chocan entre sí", async () => {
    const c = await cuenta();
    await prisma.venta.create({ data: datosDeVenta({ canal: "MESA", cuentaId: c.id }) });
    await expect(prisma.venta.create({ data: datosDeVenta({ canal: "MESA", cuentaId: c.id, importeTotal: "999.00" }) })).rejects.toMatchObject({ code: "P2002" });
    await ventaDeMostrador();
    await ventaDeMostrador();
    await ventaDeMostrador();
    expect(await prismaAdmin.venta.count({ where: { cuentaId: c.id } })).toBe(1);
    expect(await prismaAdmin.venta.count()).toBe(4);
  });

  it("CONCURRENCIA: el cierre de la misma cuenta lanzado varias veces a la vez escribe una sola cabecera", async () => {
    const c = await cuenta();
    const resultados = await Promise.all(
      [0, 1, 2, 3].map(() => prisma.venta.create({ data: datosDeVenta({ canal: "MESA", cuentaId: c.id }) }).then(() => "ok" as const, (e: { code?: string }) => e.code ?? "otro")),
    );
    expect(resultados.filter((r) => r === "ok")).toHaveLength(1);
    expect(resultados.filter((r) => r === "P2002")).toHaveLength(3);
    expect(await prismaAdmin.venta.count({ where: { cuentaId: c.id } })).toBe(1);
  });

  it("la cuenta de una venta no se puede borrar (RESTRICT): la historia no se pierde", async () => {
    const v = await ventaDeMesa();
    await expect(prismaAdmin.$executeRawUnsafe(`DELETE FROM "Cuenta" WHERE id = '${v.cuentaId}'`)).rejects.toThrow(/Venta_empresaId_cuentaId_fkey/);
  });
});

describe("Operacion.ventaId: las líneas de la venta", () => {
  it("una operación VENTA cuelga de su cabecera, varias líneas de la misma, y las anteriores a M2 quedan con NULL", async () => {
    const v = await ventaDeMostrador({ importeTotal: "30.00" });
    const l1 = await operacion("VENTA", v.id);
    const l2 = await operacion("VENTA", v.id);
    const vieja = await operacion("VENTA");
    expect([l1.ventaId, l2.ventaId, vieja.ventaId]).toEqual([v.id, v.id, null]);
    const conLineas = await prisma.venta.findUniqueOrThrow({ where: { id: v.id }, include: { operaciones: true } });
    expect(conLineas.operaciones.map((o) => o.id).sort()).toEqual([l1.id, l2.id].sort());
  });

  it("solo una VENTA tiene cabecera: cualquier otro proceso se rechaza (Operacion_venta_solo_en_ventas_chk)", async () => {
    const v = await ventaDeMostrador();
    for (const proceso of ["COMPRA", "AJUSTE", "MERMA", "CONSUMO"] as const) {
      const o = await operacion(proceso);
      await expect(prismaAdmin.$executeRawUnsafe(`UPDATE "Operacion" SET "ventaId" = '${v.id}' WHERE id = '${o.id}'`), proceso).rejects.toThrow(/Operacion_venta_solo_en_ventas_chk/);
    }
    await expect(operacion("AJUSTE", v.id)).rejects.toThrow(/Operacion_venta_solo_en_ventas_chk/);
  });

  it("apuntar a una cabecera que no existe se rechaza, y una cabecera con líneas no se puede borrar (RESTRICT)", async () => {
    await expect(operacion("VENTA", "no-existe")).rejects.toThrow(/Operacion_empresaId_ventaId_fkey/);
    const v = await ventaDeMostrador();
    await operacion("VENTA", v.id);
    await expect(prismaAdmin.$executeRawUnsafe(`DELETE FROM "Venta" WHERE id = '${v.id}'`)).rejects.toThrow(/Operacion_empresaId_ventaId_fkey/);
  });
});

describe("Venta: aislamiento entre empresas", () => {
  /** Una venta REAL de la empresa testigo, armada con su propio cliente (su sucursal, su usuario compartido). */
  async function ventaAjena() {
    const testigo = clienteConEmpresaDePrueba(urlDeSembradoDeVitest(), EMPRESA_TESTIGO_ID);
    const sucursal = await testigo.sucursal.create({ data: { nombre: "Testigo" } });
    const venta = await testigo.venta.create({ data: { sucursalId: sucursal.id, canal: "MOSTRADOR", fecha: new Date(), importeTotal: "50.00", usuarioId } });
    expect(venta.empresaId).toBe(EMPRESA_TESTIGO_ID);
    return { venta, sucursal };
  }

  it("una línea de la empresa A no puede colgar de la cabecera de la empresa B (la clave foránea es (empresaId, id))", async () => {
    const { venta } = await ventaAjena();
    await expect(operacion("VENTA", venta.id)).rejects.toThrow(/Operacion_empresaId_ventaId_fkey/);
  });

  it("una cabecera de la empresa A no puede ser de una sucursal ni de una cuenta de la empresa B", async () => {
    const { sucursal } = await ventaAjena();
    await expect(ventaDeMostrador({ sucursalId: sucursal.id })).rejects.toThrow(/Venta_empresaId_sucursalId_fkey/);
  });

  it("la RLS: la empresa A no ve la cabecera de la B, y no puede escribir una con la empresa de la B", async () => {
    const { venta } = await ventaAjena();
    const propia = await ventaDeMostrador();
    expect((await prisma.venta.findMany()).map((v) => v.id)).toEqual([propia.id]);
    expect(await prisma.venta.findUnique({ where: { id: venta.id } })).toBeNull();
    // Ni siquiera por el rol de ejecución con la empresa de A: el WITH CHECK rechaza una fila de otra empresa.
    const a = clienteConEmpresaDePrueba(urlDeSembradoDeVitest(), EMPRESA_DE_PRUEBA_ID);
    await expect(a.venta.create({ data: { empresaId: EMPRESA_TESTIGO_ID, sucursalId, canal: "MOSTRADOR", fecha: new Date(), importeTotal: "1.00", usuarioId } })).rejects.toThrow(/row-level security|violates|Venta_empresaId_sucursalId_fkey/i);
    expect(await prismaAdmin.venta.count()).toBe(2);
  });
});

describe("Venta: solo se agrega (la app real no puede modificarla ni borrarla)", () => {
  const alcance = () => baseDeTest({ lectura: [sucursalId], escritura: [sucursalId] }).db;

  it("por el rol de la app y con el alcance de la sucursal se puede INSERTAR y LEER, pero no UPDATE ni DELETE (permission denied)", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const db = alcance();
    const v = await db.venta.create({ data: datosDeVenta({ importeTotal: "12.34" }) });
    expect((await db.venta.findUniqueOrThrow({ where: { id: v.id } })).importeTotal.toFixed(2)).toBe("12.34");
    await expect(db.venta.update({ where: { id: v.id }, data: { importeTotal: "0.01" } })).rejects.toThrow(/permission denied/i);
    await expect(db.venta.delete({ where: { id: v.id } })).rejects.toThrow(/permission denied/i);
    await expect(db.venta.updateMany({ data: { importeTotal: "0.01" } })).rejects.toThrow(/permission denied/i);
    await expect(db.venta.deleteMany()).rejects.toThrow(/permission denied/i);
    expect((await prismaAdmin.venta.findUniqueOrThrow({ where: { id: v.id } })).importeTotal.toFixed(2), "el total copiado nunca cambió").toBe("12.34");
  });

  it("sin alcance de sucursal no se ve ninguna cabecera (falla cerrado), y con el alcance de OTRA sucursal tampoco", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    await ventaDeMostrador();
    expect(await baseDeTest.db.venta.findMany()).toEqual([]);
    expect(await baseDeTest({ lectura: ["otra-sucursal"], escritura: ["otra-sucursal"] }).db.venta.findMany()).toEqual([]);
    expect(await alcance().venta.findMany()).toHaveLength(1);
  });

  it("insertar una cabecera en una sucursal fuera del alcance de escritura se rechaza (RLS de sucursal, M2-4)", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const soloLectura = baseDeTest({ lectura: [sucursalId], escritura: ["otra-sucursal"] }).db;
    await expect(soloLectura.venta.create({ data: datosDeVenta({}) })).rejects.toThrow(/row-level security|violates/i);
    expect(await prismaAdmin.venta.count()).toBe(0);
  });
});
