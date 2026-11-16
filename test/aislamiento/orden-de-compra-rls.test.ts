import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { EMPRESA_DE_PRUEBA_ID, EMPRESA_TESTIGO_ID, opcionesDeConexionConEmpresa } from "../setup/empresa-de-prueba";
import { baseDeTest, limpiarBaseDeTest, prismaAdmin } from "../setup/test-db";
import { sembrarEscenarioDeFactura, type EscenarioDeFactura } from "../setup/factura-proveedor";

/**
 * Compras, orden de compra (etapa OC): la RLS de las órdenes (`OrdenDeCompra`, `LineaDeOrdenDeCompra`, `SaldoDeLineaDeOrden`, `NivelDeControl`), contra la base real y como `motor2_app`. Dos capas:
 *  - EMPRESA (`aislamiento_empresa`): nunca se ve ni se escribe una orden, una línea o un nivel de otra empresa.
 *  - SUCURSAL (migración 20261117130100): una orden DESTINADA a una sucursal solo la ve y la escribe quien tiene esa sucursal en su alcance; una orden SIN sucursal destino (de toda la empresa) la ve quien tenga alguna sucursal en su alcance; sin alcance, nada (falla cerrado).
 * Y encima, los privilegios: la app no borra ni vacía (ni órdenes, ni líneas, ni saldos, ni el nivel).
 *
 * Mutación: quitar las políticas de 20261117130100 deja en rojo «la orden destinada a B no la ve A»; darle DELETE a la app, el caso «no se borra».
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

const HASH = "a".repeat(64);
const hayRol = async (rol: string) => ((await prismaAdmin.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM pg_roles WHERE rolname = ${rol}`)[0]!.n) === BigInt(1);
const como = (lectura: string[], escritura = lectura) => baseDeTest({ lectura, escritura }).db;
const cliente = async (empresaId: string, alcance: { lectura: string[]; escritura: string[] }) => {
  const c = new Client({ connectionString: process.env.DATABASE_URL as string, options: opcionesDeConexionConEmpresa(empresaId, alcance) });
  abiertos.push(c);
  await c.connect();
  return c;
};

/** Tres órdenes pedidas (con su línea y su saldo): una destinada a A, una a B y una de toda la empresa (sin sucursal). Escritas con el dueño, que no tiene políticas. */
async function tresOrdenes() {
  const nueva = async (sucursalId: string | null) => {
    const id = randomUUID();
    await prismaAdmin.ordenDeCompra.create({
      data: { id, proveedorId: e.proveedorId, sucursalId, claveIdempotencia: randomUUID(), payloadHash: HASH, creadoPorId: e.usuarioId, estado: "BORRADOR", lineas: { create: { id: randomUUID(), numero: 1, productoId: e.productoId, cantidadPedida: "10" } } },
    });
    await prismaAdmin.ordenDeCompra.update({ where: { id }, data: { estado: "PEDIDA", pedidaPorId: e.usuarioId, pedidaEn: new Date(), fechaDeNegocio: new Date() } });
    return id;
  };
  return { a: await nueva(e.sucursalA), b: await nueva(e.sucursalB), todas: await nueva(null) };
}

describe("las órdenes: RLS por sucursal", () => {
  it("la orden destinada a B no la ve A (ni sus líneas ni sus saldos); la de toda la empresa la ve quien tiene alcance; sin alcance o con otra sucursal, la empresa NO se ve (falla cerrado)", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const { a, b, todas } = await tresOrdenes();

    expect((await como([e.sucursalA]).ordenDeCompra.findMany()).map((o) => o.id).sort()).toEqual([a, todas].sort());
    expect((await como([e.sucursalB]).ordenDeCompra.findMany()).map((o) => o.id).sort()).toEqual([b, todas].sort());
    expect((await como([e.sucursalA, e.sucursalB]).ordenDeCompra.findMany()).map((o) => o.id).sort()).toEqual([a, b, todas].sort());
    expect((await como([e.sucursalA]).lineaDeOrdenDeCompra.findMany()).map((l) => l.ordenId).sort()).toEqual([a, todas].sort());
    expect((await como([e.sucursalA]).saldoDeLineaDeOrden.findMany()).map((s) => s.ordenId).sort()).toEqual([a, todas].sort());
    expect(await baseDeTest.db.ordenDeCompra.findMany()).toEqual([]);
    expect(await como(["otra-sucursal"]).ordenDeCompra.findMany({ where: { sucursalId: { not: null } } })).toEqual([]);
  });

  it("crear una orden destinada a OTRA sucursal se rechaza (sin alcance de escritura en ella); sin sucursal destino entra con cualquier alcance de escritura; sin alcance de escritura, nunca", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const datos = (sucursalId: string | null) => ({ id: randomUUID(), proveedorId: e.proveedorId, sucursalId, claveIdempotencia: randomUUID(), payloadHash: HASH, creadoPorId: e.usuarioId });

    await expect(como([e.sucursalA]).ordenDeCompra.create({ data: datos(e.sucursalB) })).rejects.toThrow();
    await expect(como([e.sucursalA, e.sucursalB], [e.sucursalA]).ordenDeCompra.create({ data: datos(e.sucursalB) })).rejects.toThrow();
    const sinEscritura = await cliente(EMPRESA_DE_PRUEBA_ID, { lectura: [e.sucursalA], escritura: [] });
    await expect(
      sinEscritura.query(`INSERT INTO "OrdenDeCompra" ("id","proveedorId","claveIdempotencia","payloadHash","creadoPorId") VALUES ($1,$2,$3,'${HASH}',$4)`, [randomUUID(), e.proveedorId, randomUUID(), e.usuarioId]),
    ).rejects.toThrow();
    expect(await prismaAdmin.ordenDeCompra.count()).toBe(0);

    await como([e.sucursalA]).ordenDeCompra.create({ data: datos(e.sucursalA) });
    await como([e.sucursalA]).ordenDeCompra.create({ data: datos(null) });
    expect(await prismaAdmin.ordenDeCompra.count()).toBe(2);
  });

  it("la app NO borra ni vacía: DELETE y TRUNCATE de órdenes, líneas y saldos dan permission denied, aunque la orden sea de su sucursal", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const { a } = await tresOrdenes();
    await expect(como([e.sucursalA]).ordenDeCompra.delete({ where: { id: a } })).rejects.toThrow(/permission denied/i);
    await expect(como([e.sucursalA]).lineaDeOrdenDeCompra.deleteMany({ where: { ordenId: a } })).rejects.toThrow(/permission denied/i);
    const c = await cliente(EMPRESA_DE_PRUEBA_ID, { lectura: [e.sucursalA], escritura: [e.sucursalA] });
    for (const tabla of ["OrdenDeCompra", "LineaDeOrdenDeCompra", "SaldoDeLineaDeOrden", "NivelDeControl"]) await expect(c.query(`TRUNCATE TABLE "${tabla}"`), tabla).rejects.toMatchObject({ code: "42501" });
    await expect(c.query(`DELETE FROM "SaldoDeLineaDeOrden"`)).rejects.toMatchObject({ code: "42501" });
    expect(await prismaAdmin.ordenDeCompra.count()).toBe(3);
  });

  it("el saldo de una línea lo escriben SOLO los disparadores: ni la app ni el dueño lo cambian a mano", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const { a } = await tresOrdenes();
    await expect(como([e.sucursalA]).saldoDeLineaDeOrden.updateMany({ where: { ordenId: a }, data: { cantidadRecibida: "5" } })).rejects.toThrow();
    await expect(prismaAdmin.saldoDeLineaDeOrden.updateMany({ where: { ordenId: a }, data: { cantidadRecibida: "5" } })).rejects.toThrow(/solo los disparadores/);
    expect(Number((await prismaAdmin.saldoDeLineaDeOrden.findFirstOrThrow({ where: { ordenId: a } })).cantidadRecibida)).toBe(0);
  });
});

describe("la otra empresa no ve nada, ni escribe en esta", () => {
  it("una empresa no ve las órdenes ni los niveles de la otra, con ningún alcance, y no puede insertar uno con el empresaId de la otra", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    await tresOrdenes();
    await prismaAdmin.nivelDeControl.create({ data: { id: randomUUID(), empresaId: EMPRESA_DE_PRUEBA_ID, control: "compras.recepcion_excede_la_orden", nivel: "BLOQUEAR", actualizadoPorId: e.usuarioId } });
    const testigo = await cliente(EMPRESA_TESTIGO_ID, { lectura: [e.sucursalA, e.sucursalB], escritura: [e.sucursalA, e.sucursalB] });
    for (const tabla of ["OrdenDeCompra", "LineaDeOrdenDeCompra", "SaldoDeLineaDeOrden", "NivelDeControl"]) expect((await testigo.query(`SELECT count(*)::int AS n FROM "${tabla}"`)).rows[0].n, tabla).toBe(0);
    await expect(
      testigo.query(`INSERT INTO "OrdenDeCompra" ("id","empresaId","proveedorId","claveIdempotencia","payloadHash","creadoPorId") VALUES ($1,$2,$3,$4,'${HASH}',$5)`, [randomUUID(), EMPRESA_DE_PRUEBA_ID, e.proveedorId, randomUUID(), e.usuarioId]),
    ).rejects.toThrow();
    await expect(
      testigo.query(`INSERT INTO "NivelDeControl" ("id","empresaId","control","nivel","actualizadoPorId") VALUES ($1,$2,'compras.recepcion_excede_la_orden','PERMITIR',$3)`, [randomUUID(), EMPRESA_DE_PRUEBA_ID, e.usuarioId]),
    ).rejects.toThrow();
  });
});
