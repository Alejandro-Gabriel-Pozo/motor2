import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { EMPRESA_TESTIGO_ID } from "../setup/empresa-de-prueba";
import { sembrarAjeno } from "../setup/factura-proveedor";
import { cerrarConexiones, conexionComoApp, datosDeConcepto, datosDeRenglonSinStock, intentar, sembrarEscenarioDeGasto, type EscenarioDeGasto } from "../setup/gasto";
import { baseDeTest, limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";

/**
 * Paquete 3, M4.4 — migración 20261016113000_rls_sucursal_imputacion_de_gasto: la RLS por sucursal de la imputación de un gasto, contra la base real y como `motor2_app`. Dos capas, a propósito:
 *  - El RENGLÓN del gasto y la CABECERA de la factura son DE EMPRESA: se ven desde cualquier sucursal (para que la sucursal B llegue al renglón de su propia imputación) y nunca desde otra empresa.
 *  - La IMPUTACIÓN (`ImputacionDeGasto`) es PROPIA: las 4 políticas RESTRICTIVE de M4.4 la limitan al alcance de sucursal que fija `conAlcanceEnSucursal`; sin alcance no se ve ni se escribe ninguna (falla cerrado; un INSERT da 42501).
 * Quien ve una sola sucursal ve solo lo que le tocó a esa sucursal del gasto, aunque el renglón entero sea de la empresa.
 *
 * Mutaciones demostradas (ver el informe del paso): sacar las políticas de la migración M4.4 (o clasificar la tabla como DE_EMPRESA) deja en rojo «cada sucursal ve solo lo suyo»; cambiar un byte de la migración, el guardián B7.
 */
afterAll(() => prismaAdmin.$disconnect());

let e: EscenarioDeGasto;
let ayB: string;
let ayA: string;
const hayRol = async (rol: string) => ((await prismaAdmin.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM pg_roles WHERE rolname = ${rol}`)[0]!.n) === BigInt(1);

beforeEach(async () => {
  await limpiarBaseDeTest();
  e = await sembrarEscenarioDeGasto();
  ayA = (await prisma.imputacionDeGasto.create({ data: { facturaProveedorRenglonId: e.renglonId, sucursalId: e.sucursalA, importe: "120.00", importeIvaComputable: "20.00" } as never })).id;
  ayB = (await prisma.imputacionDeGasto.create({ data: { facturaProveedorRenglonId: e.renglonId, sucursalId: e.sucursalB, importe: "80.00" } as never })).id;
});
afterEach(cerrarConexiones);

const soloA = () => baseDeTest({ lectura: [e.sucursalA], escritura: [e.sucursalA] }).db;
const soloB = () => baseDeTest({ lectura: [e.sucursalB], escritura: [e.sucursalB] }).db;
const ambas = () => baseDeTest({ lectura: [e.sucursalA, e.sucursalB], escritura: [e.sucursalA, e.sucursalB] }).db;

describe("las políticas de sucursal de la imputación (M4.4)", () => {
  it("ImputacionDeGasto tiene 5 políticas (la de empresa y las 4 de sucursal, RESTRICTIVE TO motor2_app); el renglón y la cabecera, UNA sola", async () => {
    const filas = await prismaAdmin.$queryRaw<Array<{ tabla: string; nombre: string; permissive: string; roles: string }>>`
      SELECT tablename::text AS tabla, policyname::text AS nombre, permissive, roles::text AS roles FROM pg_policies
      WHERE schemaname = 'public' AND tablename IN ('FacturaProveedor', 'FacturaProveedorRenglon', 'ImputacionDeGasto', 'ConceptoDeGasto') ORDER BY 1, 2`;
    const de = (tabla: string) => filas.filter((f) => f.tabla === tabla);
    expect(de("ImputacionDeGasto").map((f) => f.nombre)).toEqual(["aislamiento_empresa", "alcance_sucursal_delete", "alcance_sucursal_insert", "alcance_sucursal_select", "alcance_sucursal_update"]);
    for (const tabla of ["FacturaProveedor", "FacturaProveedorRenglon", "ConceptoDeGasto"]) expect(de(tabla).map((f) => f.nombre), tabla).toEqual(["aislamiento_empresa"]);
    for (const f of de("ImputacionDeGasto").filter((x) => x.nombre.startsWith("alcance_sucursal_"))) expect([f.permissive, f.roles], f.nombre).toEqual(["RESTRICTIVE", "{motor2_app}"]);
  });

  it("cada sucursal ve SOLO lo que le tocó; con las dos, las dos; sin alcance, ninguna (falla cerrado)", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    expect((await soloA().imputacionDeGasto.findMany()).map((i) => i.id)).toEqual([ayA]);
    expect((await soloB().imputacionDeGasto.findMany()).map((i) => i.id)).toEqual([ayB]);
    expect((await ambas().imputacionDeGasto.findMany()).map((i) => i.id).sort()).toEqual([ayA, ayB].sort());
    expect(await baseDeTest.db.imputacionDeGasto.findMany()).toEqual([]);
    expect(await baseDeTest({ lectura: ["otra-sucursal"], escritura: ["otra-sucursal"] }).db.imputacionDeGasto.findMany()).toEqual([]);
  });

  it("lo que ve una sola sucursal es SU parte del dinero: A ve 120,00 con 20,00 de IVA computable y no ve los 80,00 de B", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const deA = await soloA().imputacionDeGasto.findMany();
    expect(deA.map((i) => [i.importe.toFixed(2), i.importeIvaComputable.toFixed(2)])).toEqual([["120.00", "20.00"]]);
    const agregado = await soloB().imputacionDeGasto.aggregate({ _sum: { importe: true }, _count: true });
    expect([agregado._sum.importe?.toFixed(2), agregado._count]).toEqual(["80.00", 1]);
  });

  it("el renglón del gasto, su concepto y la cabecera se ven desde CUALQUIER sucursal de la empresa (B llega al renglón de su imputación aunque no vea la de A), y sin alcance también", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    for (const db of [soloA(), soloB(), ambas(), baseDeTest.db]) {
      expect((await db.facturaProveedor.findMany()).map((f) => f.id)).toEqual([e.facturaId]);
      expect((await db.facturaProveedorRenglon.findMany({ where: { naturaleza: "SIN_STOCK" } })).map((r) => r.id)).toEqual([e.renglonId]);
      expect((await db.conceptoDeGasto.findMany()).map((c) => c.id)).toEqual([e.conceptoId]);
    }
    const deB = await soloB().imputacionDeGasto.findFirstOrThrow({ include: { renglon: { include: { conceptoGasto: true, facturaProveedor: true } } } });
    expect([deB.renglon.id, deB.renglon.conceptoGasto?.codigo, deB.renglon.facturaProveedor.id]).toEqual([e.renglonId, "ALQUILER", e.facturaId]);
  });

  it("una imputación de la sucursal B no se puede escribir con escritura solo en A: INSERT da 42501 (row-level security); con escritura en A, la de A entra", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const otro = await prisma.facturaProveedorRenglon.create({ data: datosDeRenglonSinStock({ facturaProveedorId: e.facturaId, conceptoGastoId: e.conceptoId }, { orden: 5 }) as never });
    await expect(soloA().imputacionDeGasto.create({ data: { facturaProveedorRenglonId: otro.id, sucursalId: e.sucursalB, importe: "10.00" } as never })).rejects.toThrow(/row-level security|violates/i);
    const cliente = await conexionComoApp(undefined, { lectura: [e.sucursalA], escritura: [e.sucursalA] });
    expect(await intentar(cliente, `INSERT INTO "ImputacionDeGasto" ("id","facturaProveedorRenglonId","sucursalId","importe") VALUES ($1,$2,$3,10.00)`, [randomUUID(), otro.id, e.sucursalB])).toMatchObject({ codigo: "42501" });
    expect(await prismaAdmin.imputacionDeGasto.count({ where: { facturaProveedorRenglonId: otro.id } })).toBe(0);
    await soloA().imputacionDeGasto.create({ data: { facturaProveedorRenglonId: otro.id, sucursalId: e.sucursalA, importe: "10.00" } as never });
    expect(await prismaAdmin.imputacionDeGasto.count({ where: { facturaProveedorRenglonId: otro.id } })).toBe(1);
  });

  it("con lectura en A pero escritura en B no se puede insertar la imputación de A, y sin alcance de escritura tampoco", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const otro = await prisma.facturaProveedorRenglon.create({ data: datosDeRenglonSinStock({ facturaProveedorId: e.facturaId, conceptoGastoId: e.conceptoId }, { orden: 5 }) as never });
    const datos = { facturaProveedorRenglonId: otro.id, sucursalId: e.sucursalA, importe: "10.00" } as never;
    await expect(baseDeTest({ lectura: [e.sucursalA], escritura: [e.sucursalB] }).db.imputacionDeGasto.create({ data: datos })).rejects.toThrow(/row-level security|violates/i);
    await expect(baseDeTest.db.imputacionDeGasto.create({ data: datos })).rejects.toThrow(/row-level security|violates/i);
  });

  it("aun con alcance propio, UPDATE y DELETE de la imputación dan permission denied (solo se agrega)", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    await expect(soloA().imputacionDeGasto.delete({ where: { id: ayA } })).rejects.toThrow(/permission denied/i);
    await expect(soloA().imputacionDeGasto.update({ where: { id: ayA }, data: { importe: "1.00" } })).rejects.toThrow(/permission denied/i);
    expect((await prismaAdmin.imputacionDeGasto.findUniqueOrThrow({ where: { id: ayA } })).importe.toFixed(2)).toBe("120.00");
  });
});

describe("la otra empresa no ve nada, ni escribe en esta", () => {
  it("una empresa no ve las imputaciones, los renglones ni los conceptos de la otra, con ningún alcance; y no puede escribir con el empresaId de ésta", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const ajeno = await sembrarAjeno(e.usuarioId);
    const conceptoAjeno = await ajeno.testigo.conceptoDeGasto.create({ data: datosDeConcepto({ codigo: "LUZ", nombre: "Luz" }) });
    const renglonAjeno = await ajeno.testigo.facturaProveedorRenglon.create({ data: datosDeRenglonSinStock({ facturaProveedorId: ajeno.factura.id, conceptoGastoId: conceptoAjeno.id }, { orden: 2 }) as never });
    await ajeno.testigo.imputacionDeGasto.create({ data: { facturaProveedorRenglonId: renglonAjeno.id, sucursalId: ajeno.sucursal.id, importe: "55.00" } as never });

    expect((await ambas().imputacionDeGasto.findMany()).map((i) => i.id).sort()).toEqual([ayA, ayB].sort());
    expect(await ambas().conceptoDeGasto.findUnique({ where: { id: conceptoAjeno.id } })).toBeNull();
    expect(await ambas().facturaProveedorRenglon.findUnique({ where: { id: renglonAjeno.id } })).toBeNull();

    const b = await conexionComoApp(EMPRESA_TESTIGO_ID, { lectura: [e.sucursalA, e.sucursalB, ajeno.sucursal.id], escritura: [e.sucursalA, e.sucursalB, ajeno.sucursal.id] });
    // Desde el testigo: solo su propia imputación, aunque el alcance nombre las sucursales de la otra empresa.
    expect((await b.query(`SELECT "importe"::text AS importe FROM "ImputacionDeGasto"`)).rows).toEqual([{ importe: "55.00" }]);
    expect(await intentar(b, `INSERT INTO "ImputacionDeGasto" ("id","empresaId","facturaProveedorRenglonId","sucursalId","importe") VALUES ($1,'empresa_principal',$2,$3,10.00)`, [randomUUID(), e.renglonId, e.sucursalA])).toMatchObject({ codigo: "42501" });
  });
});
