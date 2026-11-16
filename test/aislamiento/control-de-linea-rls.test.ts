import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { EMPRESA_DE_PRUEBA_ID, EMPRESA_TESTIGO_ID, opcionesDeConexionConEmpresa } from "../setup/empresa-de-prueba";
import { baseDeTest, limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";
import { datosDeFactura, datosDeRenglon, sembrarAjeno, sembrarEscenarioDeFactura, type EscenarioDeFactura } from "../setup/factura-proveedor";

/**
 * Compras N3-b: la RLS del control por línea de la recepción (`ControlDeLineaDeRecepcion`), contra la base real y como `motor2_app`. Dos capas, como en la parte de la factura (`factura-proveedor-rls.test.ts`):
 *  - EMPRESA (`aislamiento_empresa`): nunca se ve ni se escribe un control de otra empresa.
 *  - SUCURSAL (HEREDADA de la parte, migración 20261117120110): cada sucursal ve y escribe SOLO los controles de sus partes; sin alcance no se ve ni se escribe ninguno (falla cerrado).
 * Y encima, los privilegios: solo SELECT e INSERT (ni UPDATE ni DELETE ni TRUNCATE), aunque la sucursal sea la suya.
 *
 * Mutación: quitar las políticas de la migración 20261117120110 deja en rojo «cada sucursal ve solo sus controles»; agregar un GRANT UPDATE a la tabla, el caso «no se cambia ni se borra».
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
const soloA = () => baseDeTest({ lectura: [e.sucursalA], escritura: [e.sucursalA] }).db;
const soloB = () => baseDeTest({ lectura: [e.sucursalB], escritura: [e.sucursalB] }).db;
const ambas = () => baseDeTest({ lectura: [e.sucursalA, e.sucursalB], escritura: [e.sucursalA, e.sucursalB] }).db;

/** Una factura repartida entre las dos sucursales con un renglón y una parte PENDIENTE por sucursal, y un control por parte (escritos con el dueño, que no tiene políticas). */
async function facturaConControles() {
  const cabecera = await prisma.facturaProveedor.create({ data: datosDeFactura(e, { importeTotal: "200.00" }) as never });
  const renglon = await prisma.facturaProveedorRenglon.create({ data: datosDeRenglon({ facturaProveedorId: cabecera.id, productoId: e.productoId }, { precioTotal: "200.00" }) as never });
  const parteA = await prisma.facturaProveedorSucursal.create({ data: { facturaProveedorId: cabecera.id, sucursalId: e.sucursalA, porcentajeDeclaradoBp: 5000 } });
  const parteB = await prisma.facturaProveedorSucursal.create({ data: { facturaProveedorId: cabecera.id, sucursalId: e.sucursalB, porcentajeDeclaradoBp: 5000 } });
  const control = (parteId: string) =>
    prismaAdmin.controlDeLineaDeRecepcion.create({
      data: { id: randomUUID(), empresaId: EMPRESA_DE_PRUEBA_ID, facturaProveedorId: cabecera.id, facturaProveedorSucursalId: parteId, facturaProveedorRenglonId: renglon.id, condicion: "CONFORME", registradoPorId: e.usuarioId },
    });
  return { cabecera, renglon, parteA, parteB, controlA: await control(parteA.id), controlB: await control(parteB.id) };
}

describe("el control por línea: RLS por sucursal (HEREDADA de la parte)", () => {
  it("la tabla tiene la política de empresa y las 4 de sucursal (RESTRICTIVE TO motor2_app)", async () => {
    const filas = await prismaAdmin.$queryRaw<Array<{ nombre: string; permissive: string; roles: string }>>`
      SELECT policyname::text AS nombre, permissive, roles::text AS roles FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ControlDeLineaDeRecepcion' ORDER BY 1`;
    expect(filas.map((f) => f.nombre)).toEqual(["aislamiento_empresa", "alcance_sucursal_delete", "alcance_sucursal_insert", "alcance_sucursal_select", "alcance_sucursal_update"]);
    for (const f of filas.filter((x) => x.nombre.startsWith("alcance_sucursal_"))) expect([f.permissive, f.roles], f.nombre).toEqual(["RESTRICTIVE", "{motor2_app}"]);
  });

  it("cada sucursal ve SOLO los controles de sus partes; con las dos, los dos; sin alcance (o con otra sucursal), ninguno (falla cerrado)", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const { controlA, controlB } = await facturaConControles();
    expect((await soloA().controlDeLineaDeRecepcion.findMany()).map((c) => c.id)).toEqual([controlA.id]);
    expect((await soloB().controlDeLineaDeRecepcion.findMany()).map((c) => c.id)).toEqual([controlB.id]);
    expect((await ambas().controlDeLineaDeRecepcion.findMany()).map((c) => c.id).sort()).toEqual([controlA.id, controlB.id].sort());
    expect(await baseDeTest.db.controlDeLineaDeRecepcion.findMany()).toEqual([]);
    expect(await baseDeTest({ lectura: ["otra-sucursal"], escritura: ["otra-sucursal"] }).db.controlDeLineaDeRecepcion.findMany()).toEqual([]);
  });

  it("registrar el control de la parte de OTRA sucursal se rechaza (sin alcance de escritura en ella): no queda nada escrito; el de la propia sí entra", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const cabecera = await prisma.facturaProveedor.create({ data: datosDeFactura(e, { importeTotal: "200.00" }) as never });
    const renglon = await prisma.facturaProveedorRenglon.create({ data: datosDeRenglon({ facturaProveedorId: cabecera.id, productoId: e.productoId }, { precioTotal: "200.00" }) as never });
    const parteA = await prisma.facturaProveedorSucursal.create({ data: { facturaProveedorId: cabecera.id, sucursalId: e.sucursalA, porcentajeDeclaradoBp: 5000 } });
    const parteB = await prisma.facturaProveedorSucursal.create({ data: { facturaProveedorId: cabecera.id, sucursalId: e.sucursalB, porcentajeDeclaradoBp: 5000 } });
    const datos = (parteId: string) => ({ id: randomUUID(), facturaProveedorId: cabecera.id, facturaProveedorSucursalId: parteId, facturaProveedorRenglonId: renglon.id, condicion: "CONFORME", registradoPorId: e.usuarioId });

    await expect(soloA().controlDeLineaDeRecepcion.create({ data: datos(parteB.id) as never })).rejects.toThrow();
    // Con lectura en B pero escritura solo en A, tampoco.
    await expect(baseDeTest({ lectura: [e.sucursalB], escritura: [e.sucursalA] }).db.controlDeLineaDeRecepcion.create({ data: datos(parteB.id) as never })).rejects.toThrow();
    // Sin alcance de escritura, tampoco (con el INSERT crudo el código de Postgres es 42501).
    const cliente = new Client({ connectionString: process.env.DATABASE_URL as string, options: opcionesDeConexionConEmpresa(EMPRESA_DE_PRUEBA_ID, { lectura: [e.sucursalA, e.sucursalB], escritura: [] }) });
    abiertos.push(cliente);
    await cliente.connect();
    await expect(
      cliente.query(`INSERT INTO "ControlDeLineaDeRecepcion" ("id","facturaProveedorId","facturaProveedorSucursalId","facturaProveedorRenglonId","condicion","registradoPorId") VALUES ($1,$2,$3,$4,'CONFORME',$5)`, [randomUUID(), cabecera.id, parteA.id, renglon.id, e.usuarioId]),
    ).rejects.toThrow();
    expect(await prismaAdmin.controlDeLineaDeRecepcion.count()).toBe(0);
    // Con escritura en A, el control de la parte de A sí entra.
    await soloA().controlDeLineaDeRecepcion.create({ data: datos(parteA.id) as never });
    expect(await prismaAdmin.controlDeLineaDeRecepcion.count()).toBe(1);
  });
});

describe("el control no se borra ni se modifica, aunque la sucursal sea la suya", () => {
  it("DELETE y UPDATE de un control propio dan permission denied (solo se agrega); TRUNCATE tampoco", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const { controlA } = await facturaConControles();
    await expect(soloA().controlDeLineaDeRecepcion.delete({ where: { id: controlA.id } })).rejects.toThrow(/permission denied/i);
    await expect(soloA().controlDeLineaDeRecepcion.update({ where: { id: controlA.id }, data: { condicion: "RECHAZADA", observacion: "Cambio" } })).rejects.toThrow(/permission denied/i);
    const cliente = new Client({ connectionString: process.env.DATABASE_URL as string, options: opcionesDeConexionConEmpresa(EMPRESA_DE_PRUEBA_ID, { lectura: [e.sucursalA], escritura: [e.sucursalA] }) });
    abiertos.push(cliente);
    await cliente.connect();
    await expect(cliente.query(`TRUNCATE TABLE "ControlDeLineaDeRecepcion"`)).rejects.toMatchObject({ code: "42501" });
    expect((await prismaAdmin.controlDeLineaDeRecepcion.findUniqueOrThrow({ where: { id: controlA.id } })).condicion).toBe("CONFORME");
  });
});

describe("la otra empresa no ve nada, ni escribe en esta", () => {
  it("una empresa no ve los controles de la otra, con ningún alcance, y no puede insertar uno con el empresaId de la otra", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const { cabecera, renglon, parteA } = await facturaConControles();
    const cliente = new Client({ connectionString: process.env.DATABASE_URL as string, options: opcionesDeConexionConEmpresa(EMPRESA_TESTIGO_ID, { lectura: [e.sucursalA, e.sucursalB], escritura: [e.sucursalA, e.sucursalB] }) });
    abiertos.push(cliente);
    await cliente.connect();
    expect((await cliente.query(`SELECT count(*)::int AS n FROM "ControlDeLineaDeRecepcion"`)).rows[0].n).toBe(0);
    await expect(
      cliente.query(`INSERT INTO "ControlDeLineaDeRecepcion" ("id","empresaId","facturaProveedorId","facturaProveedorSucursalId","facturaProveedorRenglonId","condicion","registradoPorId") VALUES ($1,$2,$3,$4,$5,'CONFORME',$6)`, [
        randomUUID(),
        EMPRESA_DE_PRUEBA_ID,
        cabecera.id,
        parteA.id,
        renglon.id,
        e.usuarioId,
      ]),
    ).rejects.toMatchObject({ code: expect.stringMatching(/^(42501|23514)$/) });
    // (El disparador corre antes que la política de escritura: con la parte invisible para el testigo responde 23514; sin él sería 42501. Falla cerrado en los dos casos.)
    // Nada que ver con las demás: el ajeno arma lo suyo y sigue sin ver los de esta empresa.
    await sembrarAjeno(e.usuarioId);
    expect((await cliente.query(`SELECT count(*)::int AS n FROM "ControlDeLineaDeRecepcion"`)).rows[0].n).toBe(0);
  });
});
