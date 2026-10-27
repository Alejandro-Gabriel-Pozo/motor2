import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { clienteConEmpresaDePrueba, EMPRESA_DE_PRUEBA_ID, EMPRESA_TESTIGO_ID } from "../setup/empresa-de-prueba";
import { urlDeSembradoDeVitest } from "../setup/rol-de-pruebas";
import { baseDeTest, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase } from "../setup/test-db";
import { baseDeEmpresa } from "../../src/server/sesion/base";
import { habilitarMostradorCasoDeUso } from "../../src/server/actions/pos/casos-de-uso/habilitar-mostrador";
import { obtenerPuestoMostrador } from "../../src/server/consultas/pos/mesas";

/**
 * M1.4b del mostrador (ADR-039): el aislamiento del puesto mostrador entre empresas y entre sucursales, contra la base real y como `motor2_app` (el rol del código bajo prueba). El mostrador es una `Mesa`
 * (PROPIA) y sus cuentas son HEREDADAS de ella: la RLS que ya existe (por empresa y por sucursal, sin políticas nuevas) tiene que alcanzar. Dos empresas, dos sucursales en la principal y una en la testigo,
 * cada una con su mostrador y una cuenta abierta suya.
 *
 * Mutación: quitar la política de sucursal de `Mesa` (o de `Cuenta`) o la de empresa deja en rojo solo los casos de su tabla.
 */
afterAll(() => prismaAdmin.$disconnect());

let a1: string;
let a2: string;
let t1: string;
let usuarioId: string;
const mostrador = { a1: "", a2: "", t1: "" };
const cuenta = { a1: "", a2: "", t1: "" };

const hayRol = async (rol: string) => ((await prismaAdmin.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM pg_roles WHERE rolname = ${rol}`)[0]!.n) === BigInt(1);
const soloA1 = () => baseDeTest({ lectura: [a1], escritura: [a1] }).db;
const soloA2 = () => baseDeTest({ lectura: [a2], escritura: [a2] }).db;
const ambasDeA = () => baseDeTest({ lectura: [a1, a2], escritura: [a1, a2] }).db;
const soloT1 = () => baseDeEmpresa(EMPRESA_TESTIGO_ID, { lectura: [t1], escritura: [t1] }).db;
const ids = (filas: Array<{ id: string }>) => filas.map((f) => f.id).sort();

beforeEach(async () => {
  await limpiarBaseDeTest();
  const base = await sembrarBase();
  a1 = base.sucursal.id;
  a2 = (await prisma.sucursal.create({ data: { nombre: "Norte" } })).id;
  usuarioId = (await prisma.user.create({ data: { email: "cajero@test.com" } })).id;
  const testigo = clienteConEmpresaDePrueba(urlDeSembradoDeVitest(), EMPRESA_TESTIGO_ID);
  t1 = (await testigo.sucursal.create({ data: { nombre: "Testigo" } })).id;
  for (const [clave, cliente, sucursalId] of [["a1", prisma, a1], ["a2", prisma, a2], ["t1", testigo, t1]] as const) {
    const m = await cliente.mesa.create({ data: { sucursalId, numero: 0, tipo: "MOSTRADOR" } });
    mostrador[clave] = m.id;
    cuenta[clave] = (await cliente.cuenta.create({ data: { mesaId: m.id, abiertaPorId: usuarioId, tipoMesa: "MOSTRADOR" } })).id;
  }
});

describe("el mostrador de cada sucursal es de esa sucursal; el de otra empresa no se ve nunca", () => {
  it("como motor2_app con la sucursal A1: ve SU mostrador y SU cuenta, no los de A2 ni los de la otra empresa", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    expect(ids(await soloA1().mesa.findMany({ where: { tipo: "MOSTRADOR" } }))).toEqual([mostrador.a1]);
    expect(ids(await soloA1().cuenta.findMany())).toEqual([cuenta.a1]);
    expect(ids(await soloA2().mesa.findMany({ where: { tipo: "MOSTRADOR" } }))).toEqual([mostrador.a2]);
    expect(ids(await soloA2().cuenta.findMany())).toEqual([cuenta.a2]);
  });

  it("con las dos sucursales de la empresa ve los dos mostradores y nunca el de la empresa testigo; sin alcance no ve nada (falla cerrado)", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    expect(ids(await ambasDeA().mesa.findMany({ where: { tipo: "MOSTRADOR" } }))).toEqual([mostrador.a1, mostrador.a2].sort());
    expect(ids(await ambasDeA().cuenta.findMany())).toEqual([cuenta.a1, cuenta.a2].sort());
    expect(await baseDeTest.db.mesa.findMany({ where: { tipo: "MOSTRADOR" } })).toEqual([]);
    expect(await baseDeTest.db.cuenta.findMany()).toEqual([]);
    expect(await baseDeTest({ lectura: ["otra-sucursal"], escritura: ["otra-sucursal"] }).db.mesa.findMany()).toEqual([]);
  });

  it("la empresa testigo ve el suyo y ninguno de la principal", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    expect(ids(await soloT1().mesa.findMany({ where: { tipo: "MOSTRADOR" } }))).toEqual([mostrador.t1]);
    expect(ids(await soloT1().cuenta.findMany())).toEqual([cuenta.t1]);
    expect(EMPRESA_DE_PRUEBA_ID).not.toBe(EMPRESA_TESTIGO_ID);
  });

  it("la lectura del puesto (`obtenerPuestoMostrador`) respeta la sucursal: la de A1 trae el suyo con 1 cuenta abierta; pedir el de A2 desde A1, o el de la otra empresa, da null", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    expect(await obtenerPuestoMostrador(a1, soloA1())).toEqual({ id: mostrador.a1, cuentasAbiertas: 1 });
    expect(await obtenerPuestoMostrador(a2, soloA1())).toBeNull();
    expect(await obtenerPuestoMostrador(t1, soloA1())).toBeNull();
    expect(await obtenerPuestoMostrador(a1, soloT1())).toBeNull();
  });
});

describe("escribir: el alcance de escritura y la empresa mandan", () => {
  it("habilitar el mostrador de OTRA sucursal con el alcance de A1 se rechaza (RLS) y no deja nada", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    await prismaAdmin.cuenta.deleteMany({ where: { id: cuenta.a2 } });
    await prismaAdmin.mesa.delete({ where: { id: mostrador.a2 } });
    const { transaccion } = baseDeTest({ lectura: [a1, a2], escritura: [a1] });
    await expect(habilitarMostradorCasoDeUso({ usuarioId, sucursalId: a2, transaccion })).rejects.toThrow();
    expect(await prisma.mesa.count({ where: { sucursalId: a2, tipo: "MOSTRADOR" } })).toBe(0);
  });

  it("con solo lectura de A1 tampoco se puede abrir una cuenta en su mostrador", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    await prismaAdmin.cuenta.deleteMany({ where: { id: cuenta.a1 } });
    const soloLeeA1 = baseDeTest({ lectura: [a1], escritura: [] }).db;
    await expect(soloLeeA1.cuenta.create({ data: { mesaId: mostrador.a1, abiertaPorId: usuarioId, tipoMesa: "MOSTRADOR" } })).rejects.toThrow();
  });

  it("una cuenta de la empresa principal no puede apuntar al mostrador de la testigo (la FK incluye la empresa)", async () => {
    // Se cierra la cuenta de la testigo para que el árbitro de «una abierta por mesa» no responda antes que la FK.
    await prismaAdmin.cuenta.update({ where: { id: cuenta.t1 }, data: { cerradaEn: new Date(), cerradaPorId: usuarioId } });
    await expect(
      prismaAdmin.$executeRawUnsafe(`INSERT INTO "Cuenta" ("id","empresaId","mesaId","tipoMesa","abiertaPorId") VALUES ('cta-cruzada','${EMPRESA_DE_PRUEBA_ID}','${mostrador.t1}','MOSTRADOR','${usuarioId}')`),
    ).rejects.toThrow(/Cuenta_empresaId_mesaId_tipoMesa_fkey/);
  });
});
