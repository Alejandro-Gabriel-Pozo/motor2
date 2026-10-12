import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { EMPRESA_DE_PRUEBA_ID, EMPRESA_TESTIGO_ID, opcionesDeConexionConEmpresa } from "../setup/empresa-de-prueba";
import { baseDeTest, limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";
import { datosDeFactura, datosDeRenglon, sembrarAjeno, sembrarEscenarioDeFactura, type EscenarioDeFactura } from "../setup/factura-proveedor";

/**
 * Paquete 3, M3c: la RLS de la factura de proveedor, contra la base real y como `motor2_app` (el rol de la app). Dos capas distintas, a propósito:
 *  - La CABECERA (`FacturaProveedor`) y el RENGLÓN son DE EMPRESA: se ven desde cualquier sucursal de la empresa (para que la sucursal B vea la cabecera de su parte) y nunca desde otra empresa.
 *  - La PARTE de cada sucursal (`FacturaProveedorSucursal`) es PROPIA: las 4 políticas RESTRICTIVE de M3c (20261016102000) la limitan al alcance de sucursal que fija `conAlcanceEnSucursal`; sin alcance
 *    no se ve ni se escribe ninguna (falla cerrado; un INSERT da 42501).
 * Y encima, los privilegios de M3b: ni DELETE, ni UPDATE del dinero, pero sí UPDATE del estado.
 *
 * Mutación: quitar las políticas de la migración M3c (o clasificar la parte como DE_EMPRESA) deja en rojo «cada sucursal ve solo sus partes»; agregar un GRANT UPDATE de tabla completa a `FacturaProveedor`, el caso
 * de «el total no se modifica».
 */
afterAll(() => prismaAdmin.$disconnect());

let e: EscenarioDeFactura;
const abiertos: Client[] = [];

beforeEach(async () => {
  await limpiarBaseDeTest();
  e = await sembrarEscenarioDeFactura();
});

afterEach(async () => {
  await Promise.all(abiertos.splice(0).map((c) => c.end().catch(() => undefined)));
});

const hayRol = async (rol: string) => ((await prismaAdmin.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM pg_roles WHERE rolname = ${rol}`)[0]!.n) === BigInt(1);

/** Una factura repartida entre las dos sucursales: cabecera, renglón y una parte por sucursal (escritas con el rol de fixtures, que no tiene políticas de sucursal). */
async function facturaRepartida() {
  const cabecera = await prisma.facturaProveedor.create({ data: datosDeFactura(e, { importeTotal: "200.00" }) as never });
  const renglon = await prisma.facturaProveedorRenglon.create({ data: datosDeRenglon({ facturaProveedorId: cabecera.id, productoId: e.productoId }, { precioTotal: "200.00" }) as never });
  const parteA = await prisma.facturaProveedorSucursal.create({ data: { facturaProveedorId: cabecera.id, sucursalId: e.sucursalA, porcentajeDeclaradoBp: 5000 } });
  const parteB = await prisma.facturaProveedorSucursal.create({ data: { facturaProveedorId: cabecera.id, sucursalId: e.sucursalB, porcentajeDeclaradoBp: 5000 } });
  return { cabecera, renglon, parteA, parteB };
}

const soloA = () => baseDeTest({ lectura: [e.sucursalA], escritura: [e.sucursalA] }).db;
const soloB = () => baseDeTest({ lectura: [e.sucursalB], escritura: [e.sucursalB] }).db;
const ambas = () => baseDeTest({ lectura: [e.sucursalA, e.sucursalB], escritura: [e.sucursalA, e.sucursalB] }).db;

describe("las políticas de sucursal de la parte (M3c)", () => {
  it("FacturaProveedorSucursal tiene 5 políticas (la de empresa y las 4 de sucursal, RESTRICTIVE TO motor2_app); la cabecera y el renglón, UNA sola", async () => {
    const filas = await prismaAdmin.$queryRaw<Array<{ tabla: string; nombre: string; permissive: string; roles: string }>>`
      SELECT tablename::text AS tabla, policyname::text AS nombre, permissive, roles::text AS roles FROM pg_policies
      WHERE schemaname = 'public' AND tablename IN ('FacturaProveedor', 'FacturaProveedorRenglon', 'FacturaProveedorSucursal') ORDER BY 1, 2`;
    const de = (tabla: string) => filas.filter((f) => f.tabla === tabla);
    expect(de("FacturaProveedor").map((f) => f.nombre)).toEqual(["aislamiento_empresa"]);
    expect(de("FacturaProveedorRenglon").map((f) => f.nombre)).toEqual(["aislamiento_empresa"]);
    expect(de("FacturaProveedorSucursal").map((f) => f.nombre)).toEqual(["aislamiento_empresa", "alcance_sucursal_delete", "alcance_sucursal_insert", "alcance_sucursal_select", "alcance_sucursal_update"]);
    for (const f of de("FacturaProveedorSucursal").filter((x) => x.nombre.startsWith("alcance_sucursal_"))) {
      expect([f.permissive, f.roles], f.nombre).toEqual(["RESTRICTIVE", "{motor2_app}"]);
    }
  });

  it("cada sucursal ve SOLO sus partes; con las dos, las dos; sin alcance, ninguna (falla cerrado)", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const { parteA, parteB } = await facturaRepartida();
    expect((await soloA().facturaProveedorSucursal.findMany()).map((p) => p.id)).toEqual([parteA.id]);
    expect((await soloB().facturaProveedorSucursal.findMany()).map((p) => p.id)).toEqual([parteB.id]);
    expect((await ambas().facturaProveedorSucursal.findMany()).map((p) => p.id).sort()).toEqual([parteA.id, parteB.id].sort());
    expect(await baseDeTest.db.facturaProveedorSucursal.findMany()).toEqual([]);
    expect(await baseDeTest({ lectura: ["otra-sucursal"], escritura: ["otra-sucursal"] }).db.facturaProveedorSucursal.findMany()).toEqual([]);
  });

  it("la cabecera y el renglón se ven desde CUALQUIER sucursal de la empresa (la parte de B ve la cabecera de la factura), y sin alcance también", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const { cabecera, renglon } = await facturaRepartida();
    for (const db of [soloA(), soloB(), ambas(), baseDeTest.db]) {
      expect((await db.facturaProveedor.findMany()).map((f) => f.id)).toEqual([cabecera.id]);
      expect((await db.facturaProveedorRenglon.findMany()).map((r) => r.id)).toEqual([renglon.id]);
    }
    // La parte de B llega a su cabecera por la relación aunque no vea la parte de A.
    const deB = await soloB().facturaProveedorSucursal.findFirstOrThrow({ include: { facturaProveedor: true } });
    expect(deB.facturaProveedor.id).toBe(cabecera.id);
  });

  it("una parte de la sucursal B no se puede escribir con escritura solo en A: INSERT da 42501 (row-level security)", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const cabecera = await prisma.facturaProveedor.create({ data: datosDeFactura(e) as never });
    await expect(soloA().facturaProveedorSucursal.create({ data: { facturaProveedorId: cabecera.id, sucursalId: e.sucursalB, porcentajeDeclaradoBp: 10000 } })).rejects.toThrow(/row-level security|violates/i);
    // Por el rol crudo, el código de Postgres es 42501.
    const cliente = new Client({ connectionString: process.env.DATABASE_URL as string, options: opcionesDeConexionConEmpresa(EMPRESA_DE_PRUEBA_ID, { lectura: [e.sucursalA], escritura: [e.sucursalA] }) });
    abiertos.push(cliente);
    await cliente.connect();
    await expect(
      cliente.query(`INSERT INTO "FacturaProveedorSucursal" ("id","facturaProveedorId","sucursalId","porcentajeDeclaradoBp") VALUES ($1,$2,$3,10000)`, [randomUUID(), cabecera.id, e.sucursalB]),
    ).rejects.toMatchObject({ code: "42501" });
    expect(await prismaAdmin.facturaProveedorSucursal.count()).toBe(0);
    // Y con escritura en A, la de A sí entra.
    await soloA().facturaProveedorSucursal.create({ data: { facturaProveedorId: cabecera.id, sucursalId: e.sucursalA, porcentajeDeclaradoBp: 10000 } });
    expect(await prismaAdmin.facturaProveedorSucursal.count()).toBe(1);
  });

  it("con lectura en A pero escritura en B no se puede insertar la parte de A, y sin alcance de escritura tampoco", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const cabecera = await prisma.facturaProveedor.create({ data: datosDeFactura(e) as never });
    const datos = { facturaProveedorId: cabecera.id, sucursalId: e.sucursalA, porcentajeDeclaradoBp: 10000 };
    await expect(baseDeTest({ lectura: [e.sucursalA], escritura: [e.sucursalB] }).db.facturaProveedorSucursal.create({ data: datos })).rejects.toThrow(/row-level security|violates/i);
    await expect(baseDeTest.db.facturaProveedorSucursal.create({ data: datos })).rejects.toThrow(/row-level security|violates/i);
  });
});

describe("la parte no se borra ni se modifica, aunque la sucursal sea la suya", () => {
  it("DELETE y UPDATE de una parte propia dan permission denied (solo se agrega)", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const { parteA } = await facturaRepartida();
    await expect(soloA().facturaProveedorSucursal.delete({ where: { id: parteA.id } })).rejects.toThrow(/permission denied/i);
    await expect(soloA().facturaProveedorSucursal.update({ where: { id: parteA.id }, data: { porcentajeDeclaradoBp: 1 } })).rejects.toThrow(/permission denied/i);
    expect((await prismaAdmin.facturaProveedorSucursal.findUniqueOrThrow({ where: { id: parteA.id } })).porcentajeDeclaradoBp).toBe(5000);
  });
});

describe("la cabecera: el dinero no se modifica y el estado sí (privilegios por columna, D4)", () => {
  it("DELETE da 42501, UPDATE de importeTotal da 42501, UPDATE de estado (y de una anulación) funciona", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const { cabecera } = await facturaRepartida();
    const pendiente = await prisma.facturaProveedor.create({ data: { ...datosDeFactura(e), estado: "PENDIENTE_DE_REPARTO", confirmadaEn: null, confirmadaPorId: null } as never });
    const cliente = new Client({ connectionString: process.env.DATABASE_URL as string, options: opcionesDeConexionConEmpresa(EMPRESA_DE_PRUEBA_ID, { lectura: [e.sucursalA], escritura: [e.sucursalA] }) });
    abiertos.push(cliente);
    await cliente.connect();
    await expect(cliente.query(`DELETE FROM "FacturaProveedor" WHERE id = $1`, [cabecera.id])).rejects.toMatchObject({ code: "42501" });
    await expect(cliente.query(`UPDATE "FacturaProveedor" SET "importeTotal" = 1 WHERE id = $1`, [cabecera.id])).rejects.toMatchObject({ code: "42501" });
    await cliente.query(`UPDATE "FacturaProveedor" SET "estado" = 'CONFIRMADA', "confirmadaEn" = now(), "confirmadaPorId" = $2 WHERE id = $1`, [pendiente.id, e.usuarioId]);
    await cliente.query(`UPDATE "FacturaProveedor" SET "anuladaEn" = now(), "anuladaPorId" = $2 WHERE id = $1`, [cabecera.id, e.usuarioId]);
    const hoy = await prismaAdmin.facturaProveedor.findMany({ orderBy: { id: "asc" } });
    expect(hoy.find((f) => f.id === pendiente.id)?.estado).toBe("CONFIRMADA");
    expect(hoy.find((f) => f.id === cabecera.id)?.anuladaPorId).toBe(e.usuarioId);
    expect(hoy.map((f) => f.importeTotal.toFixed(2)).sort()).toEqual(["100.00", "200.00"]);
  });
});

describe("la otra empresa no ve nada, ni escribe en esta", () => {
  it("una empresa no ve la cabecera, el renglón ni la parte de la otra, con ningún alcance", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const ajeno = await sembrarAjeno(e.usuarioId);
    await facturaRepartida();
    const propias = await ambas().facturaProveedor.findMany();
    expect(propias.map((f) => f.id)).not.toContain(ajeno.factura.id);
    expect(await ambas().facturaProveedor.findUnique({ where: { id: ajeno.factura.id } })).toBeNull();
    expect(await ambas().facturaProveedorRenglon.findUnique({ where: { id: ajeno.renglon.id } })).toBeNull();
    const cliente = new Client({ connectionString: process.env.DATABASE_URL as string, options: opcionesDeConexionConEmpresa(EMPRESA_TESTIGO_ID, { lectura: [e.sucursalA, e.sucursalB], escritura: [e.sucursalA, e.sucursalB] }) });
    abiertos.push(cliente);
    await cliente.connect();
    // Desde el testigo: solo su propia cabecera, ni una parte de la empresa de prueba aunque el alcance nombre sus sucursales.
    expect((await cliente.query(`SELECT count(*)::int AS n FROM "FacturaProveedor"`)).rows[0].n).toBe(1);
    expect((await cliente.query(`SELECT count(*)::int AS n FROM "FacturaProveedorSucursal"`)).rows[0].n).toBe(0);
    await expect(cliente.query(`INSERT INTO "FacturaProveedorSucursal" ("id","empresaId","facturaProveedorId","sucursalId","porcentajeDeclaradoBp") VALUES ($1,$2,$3,$4,10000)`, [randomUUID(), EMPRESA_DE_PRUEBA_ID, ajeno.factura.id, e.sucursalA])).rejects.toMatchObject({ code: "42501" });
  });
});
