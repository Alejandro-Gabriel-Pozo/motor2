import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { sembrarDistribucion, sembrarEscenarioDeCentros, sentenciaDeInsercion, sentenciaDeLinea, sentenciaDeVersion, type EscenarioDeCentros } from "../setup/centros-de-costos";
import { EMPRESA_DE_PRUEBA_ID, EMPRESA_TESTIGO_ID } from "../setup/empresa-de-prueba";
import { sembrarAjeno } from "../setup/factura-proveedor";
import { cerrarConexiones, conexionComoApp, intentar } from "../setup/gasto";
import { baseDeTest, limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";

/**
 * Paquete 5, M7.3 — migración 20261019102000_rls_sucursal_centros_de_costos: la RLS de los centros de costos, contra la base real y como `motor2_app`. Dos capas, a propósito:
 *  - El PLAN y el CENTRO son DE EMPRESA: se ven desde cualquier sucursal, y también sin alcance (el catálogo de la empresa), y nunca desde otra empresa.
 *  - La APLICABILIDAD (`PlanDeCostosSucursal`, PROPIA), la VERSIÓN de distribución (HEREDADA de la imputación) y su LÍNEA (HEREDADA de la versión: cadena de dos niveles) quedan limitadas por las 4 políticas RESTRICTIVE de M7.3 al alcance de sucursal
 *    que fija `conAlcanceEnSucursal`; sin alcance no se ve ni se escribe nada (falla cerrado; un INSERT da 42501). Quien ve una sola sucursal ve solo las distribuciones de los gastos de esa sucursal, aunque el catálogo sea de la empresa.
 *
 * Mutaciones demostradas (ver las filas O.300 a O.309 de docs/pureza-integracion.md): aplicar el `down.sql` de M7.3 sobre la base de la prueba deja en rojo «cada sucursal ve solo lo suyo»; cambiar un byte de la migración, el guardián B7.
 */
afterAll(() => prismaAdmin.$disconnect());

let e: EscenarioDeCentros;
let versionA: string;
let versionB: string;
const hayRol = async (rol: string) => ((await prismaAdmin.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM pg_roles WHERE rolname = ${rol}`)[0]!.n) === BigInt(1);

beforeEach(async () => {
  await limpiarBaseDeTest();
  e = await sembrarEscenarioDeCentros();
  // A: 120,00 (IVA 20,00) entre las dos unidades, 60 % y 40 %; B: 80,00 todo a una unidad.
  versionA = await sembrarDistribucion(e, e.imputacionAId, [
    { centroId: e.centroUnAId, porcentajeBp: 6000, importe: "72.00", importeIvaComputable: "12.00" },
    { centroId: e.centroUnBId, porcentajeBp: 4000, importe: "48.00", importeIvaComputable: "8.00" },
  ]);
  versionB = await sembrarDistribucion(e, e.imputacionBId, [{ centroId: e.centroUnAId, porcentajeBp: 10000, importe: "80.00" }]);
});
afterEach(cerrarConexiones);

const soloA = () => baseDeTest({ lectura: [e.sucursalA], escritura: [e.sucursalA] }).db;
const soloB = () => baseDeTest({ lectura: [e.sucursalB], escritura: [e.sucursalB] }).db;
const ambas = () => baseDeTest({ lectura: [e.sucursalA, e.sucursalB], escritura: [e.sucursalA, e.sucursalB] }).db;
const probar = (c: Parameters<typeof intentar>[0], s: { texto: string; params: unknown[] }) => intentar(c, s.texto, s.params);
const ids = (filas: Array<{ id: string }>) => filas.map((f) => f.id).sort();

describe("las políticas de los centros de costos (M7.1 y M7.3)", () => {
  it("el plan y el centro tienen UNA sola política (la de empresa); la aplicabilidad, la versión y la línea tienen 5 (la de empresa y las 4 de sucursal, RESTRICTIVE TO motor2_app)", async () => {
    const filas = await prismaAdmin.$queryRaw<Array<{ tabla: string; nombre: string; permissive: string; roles: string }>>`
      SELECT tablename::text AS tabla, policyname::text AS nombre, permissive, roles::text AS roles FROM pg_policies
       WHERE schemaname = 'public' AND tablename IN ('PlanDeCostos', 'CentroDeCostos', 'PlanDeCostosSucursal', 'DistribucionCostoVersion', 'DistribucionCostoLinea') ORDER BY 1, 2`;
    const de = (tabla: string) => filas.filter((f) => f.tabla === tabla);
    for (const tabla of ["PlanDeCostos", "CentroDeCostos"]) expect(de(tabla).map((f) => f.nombre), tabla).toEqual(["aislamiento_empresa"]);
    for (const tabla of ["PlanDeCostosSucursal", "DistribucionCostoVersion", "DistribucionCostoLinea"]) {
      expect(de(tabla).map((f) => f.nombre), tabla).toEqual(["aislamiento_empresa", "alcance_sucursal_delete", "alcance_sucursal_insert", "alcance_sucursal_select", "alcance_sucursal_update"]);
      for (const f of de(tabla).filter((x) => x.nombre.startsWith("alcance_sucursal_"))) expect([f.permissive, f.roles], `${tabla}.${f.nombre}`).toEqual(["RESTRICTIVE", "{motor2_app}"]);
    }
  });
});

describe("cada sucursal ve SOLO lo suyo; con las dos, todo; sin alcance, nada (falla cerrado)", () => {
  it("las versiones y las líneas: A ve las de su imputación, B las suyas, las dos ven todo, sin alcance o con una sucursal ajena no se ve ninguna", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    expect(ids(await soloA().distribucionCostoVersion.findMany())).toEqual([versionA]);
    expect(ids(await soloB().distribucionCostoVersion.findMany())).toEqual([versionB]);
    expect(ids(await ambas().distribucionCostoVersion.findMany())).toEqual([versionA, versionB].sort());
    expect(await baseDeTest.db.distribucionCostoVersion.findMany()).toEqual([]);
    expect(await baseDeTest({ lectura: ["otra-sucursal"], escritura: ["otra-sucursal"] }).db.distribucionCostoVersion.findMany()).toEqual([]);

    const lineasDe = async (db: ReturnType<typeof soloA>) => (await db.distribucionCostoLinea.findMany()).map((l) => l.distribucionCostoVersionId).sort();
    expect(await lineasDe(soloA())).toEqual([versionA, versionA]);
    expect(await lineasDe(soloB())).toEqual([versionB]);
    expect((await lineasDe(ambas())).length).toBe(3);
    expect(await baseDeTest.db.distribucionCostoLinea.findMany()).toEqual([]);
    expect(await baseDeTest({ lectura: ["otra-sucursal"], escritura: ["otra-sucursal"] }).db.distribucionCostoLinea.findMany()).toEqual([]);
  });

  it("la aplicabilidad: A ve solo las filas de su sucursal (una por plan), B las suyas, las dos todas; sin alcance, ninguna", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const sucursalesDe = async (db: ReturnType<typeof soloA>) => (await db.planDeCostosSucursal.findMany()).map((a) => a.sucursalId).sort();
    expect(await sucursalesDe(soloA())).toEqual([e.sucursalA, e.sucursalA]);
    expect(await sucursalesDe(soloB())).toEqual([e.sucursalB, e.sucursalB]);
    expect(await sucursalesDe(ambas())).toEqual([e.sucursalA, e.sucursalA, e.sucursalB, e.sucursalB].sort());
    expect(await baseDeTest.db.planDeCostosSucursal.findMany()).toEqual([]);
    expect(await baseDeTest({ lectura: ["otra-sucursal"], escritura: ["otra-sucursal"] }).db.planDeCostosSucursal.findMany()).toEqual([]);
  });

  it("lo que ve una sola sucursal es SU parte del dinero: A ve 120,00 con 20,00 de IVA computable repartidos en dos líneas y no ve los 80,00 de B", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const deA = await soloA().distribucionCostoLinea.findMany({ orderBy: { importe: "desc" } });
    expect(deA.map((l) => [l.porcentajeBp, l.importe.toFixed(2), l.importeIvaComputable.toFixed(2)])).toEqual([[6000, "72.00", "12.00"], [4000, "48.00", "8.00"]]);
    const agregadoB = await soloB().distribucionCostoLinea.aggregate({ _sum: { importe: true }, _count: true });
    expect([agregadoB._sum.importe?.toFixed(2), agregadoB._count]).toEqual(["80.00", 1]);
    const conVersion = await soloB().distribucionCostoLinea.findFirstOrThrow({ include: { version: { include: { imputacion: true } }, centro: true } });
    expect([conVersion.version.imputacion.sucursalId, conVersion.centro.codigo]).toEqual([e.sucursalB, "UN_A"]);
  });

  it("el plan y el centro (DE EMPRESA) se ven desde CUALQUIER sucursal y también sin alcance", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    for (const db of [soloA(), soloB(), ambas(), baseDeTest.db]) {
      expect(ids(await db.planDeCostos.findMany())).toEqual([e.planId, e.planOtroId].sort());
      expect(ids(await db.centroDeCostos.findMany())).toEqual([e.centroUnAId, e.centroUnBId, e.centroOtroPlanId].sort());
    }
    // B llega al centro y al plan de su línea aunque no vea la distribución de A.
    const deB = await soloB().distribucionCostoLinea.findFirstOrThrow({ include: { centro: { include: { plan: true } } } });
    expect([deB.centro.codigo, deB.centro.plan.codigo]).toEqual(["UN_A", "PLAN_UN"]);
  });
});

describe("la escritura cruzada: sin la sucursal en el alcance de ESCRITURA, nada entra", () => {
  it("con lectura en A y B pero escritura solo en A: la versión y la línea de la imputación de B, y la aplicabilidad de B, dan 42501; las de A entran", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const tercero = await prisma.planDeCostos.create({ data: { codigo: "PLAN_TRES", nombre: "Plan tres" } });
    const cliente = await conexionComoApp(undefined, { lectura: [e.sucursalA, e.sucursalB], escritura: [e.sucursalA] });
    // Aplicabilidad: la de B no entra, la de A sí.
    expect(await probar(cliente, sentenciaDeInsercion("PlanDeCostosSucursal", { id: randomUUID(), planDeCostosId: tercero.id, sucursalId: e.sucursalB, aplica: true }))).toMatchObject({ codigo: "42501" });
    expect(await probar(cliente, sentenciaDeInsercion("PlanDeCostosSucursal", { id: randomUUID(), planDeCostosId: tercero.id, sucursalId: e.sucursalA, aplica: true }))).toBeNull();
    // Versión: la de la imputación de B no entra (ni siquiera es de otro plan), la de A sí.
    const deB = sentenciaDeVersion({ imputacionId: e.imputacionBId, planId: e.planId, usuarioId: e.usuarioId }, { numero: 2, motivo: "Corrección" });
    expect(await probar(cliente, deB)).toMatchObject({ codigo: "42501" });
    const deA = sentenciaDeVersion({ imputacionId: e.imputacionAId, planId: e.planOtroId, usuarioId: e.usuarioId });
    expect(await probar(cliente, deA)).toBeNull();
    // Línea: una línea nueva en la versión de B (que A puede LEER pero no escribir) da 42501; en la versión de A entra (centro del mismo plan).
    expect(await probar(cliente, sentenciaDeLinea({ versionId: versionB, planId: e.planId, centroId: e.centroUnBId }, { porcentajeBp: 1, importe: "0.00", importeIvaComputable: "0.00" }))).toMatchObject({ codigo: "42501" });
    expect(await probar(cliente, sentenciaDeLinea({ versionId: deA.id, planId: e.planOtroId, centroId: e.centroOtroPlanId }))).toBeNull();
    expect(await prismaAdmin.distribucionCostoVersion.count({ where: { imputacionDeGastoId: e.imputacionBId } })).toBe(1);
  });

  it("con lectura en A pero escritura en B no se puede insertar la distribución de A, y sin alcance de escritura tampoco", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const lecturaEnA = await conexionComoApp(undefined, { lectura: [e.sucursalA], escritura: [e.sucursalB] });
    expect(await probar(lecturaEnA, sentenciaDeVersion({ imputacionId: e.imputacionAId, planId: e.planOtroId, usuarioId: e.usuarioId }))).toMatchObject({ codigo: "42501" });
    const sinAlcance = await conexionComoApp();
    expect(await probar(sinAlcance, sentenciaDeVersion({ imputacionId: e.imputacionAId, planId: e.planOtroId, usuarioId: e.usuarioId }))).toMatchObject({ codigo: "42501" });
    expect(await probar(sinAlcance, sentenciaDeInsercion("PlanDeCostosSucursal", { id: randomUUID(), planDeCostosId: e.planId, sucursalId: e.sucursalA, aplica: true }))).toMatchObject({ codigo: "42501" });
    expect(await prismaAdmin.distribucionCostoVersion.count()).toBe(2);
  });

  it("`aplica` se cambia solo con escritura en la sucursal: en la propia anda; en la de B (escritura solo en A) no cambia ninguna fila (la política la oculta del UPDATE)", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const cliente = await conexionComoApp(undefined, { lectura: [e.sucursalA, e.sucursalB], escritura: [e.sucursalA] });
    const propia = await cliente.query(`UPDATE "PlanDeCostosSucursal" SET "aplica" = false WHERE "sucursalId" = $1`, [e.sucursalA]);
    const ajena = await cliente.query(`UPDATE "PlanDeCostosSucursal" SET "aplica" = false WHERE "sucursalId" = $1`, [e.sucursalB]);
    expect([propia.rowCount, ajena.rowCount]).toEqual([2, 0]);
    expect(await prismaAdmin.planDeCostosSucursal.count({ where: { sucursalId: e.sucursalB, aplica: true } })).toBe(2);
    expect(await prismaAdmin.planDeCostosSucursal.count({ where: { sucursalId: e.sucursalA, aplica: false } })).toBe(2);
  });

  it("aun con alcance propio, UPDATE y DELETE de la versión y de la línea dan permission denied (solo se agrega)", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    await expect(soloA().distribucionCostoVersion.delete({ where: { id: versionA } })).rejects.toThrow(/permission denied/i);
    await expect(soloA().distribucionCostoVersion.update({ where: { id: versionA }, data: { motivo: "otro" } })).rejects.toThrow(/permission denied/i);
    const linea = await soloA().distribucionCostoLinea.findFirstOrThrow();
    await expect(soloA().distribucionCostoLinea.delete({ where: { id: linea.id } })).rejects.toThrow(/permission denied/i);
    await expect(soloA().distribucionCostoLinea.update({ where: { id: linea.id }, data: { importe: "1.00" } })).rejects.toThrow(/permission denied/i);
    expect((await prismaAdmin.distribucionCostoLinea.findUniqueOrThrow({ where: { id: linea.id } })).importe.toFixed(2)).toBe(linea.importe.toFixed(2));
  });
});

describe("la otra empresa no ve nada, ni escribe en esta", () => {
  it("una empresa no ve los planes, centros, aplicabilidad, versiones ni líneas de la otra, con ningún alcance; y no puede escribir con el empresaId de ésta, en ninguna de las 5 tablas", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const ajeno = await sembrarAjeno(e.usuarioId);
    const planAjeno = await ajeno.testigo.planDeCostos.create({ data: { codigo: "PLAN_T", nombre: "Plan testigo" } });
    await ajeno.testigo.centroDeCostos.create({ data: { planDeCostosId: planAjeno.id, codigo: "UN_T", nombre: "Unidad testigo" } });

    // La empresa de prueba solo ve lo suyo.
    expect(ids(await ambas().planDeCostos.findMany())).toEqual([e.planId, e.planOtroId].sort());
    expect(await ambas().planDeCostos.findUnique({ where: { id: planAjeno.id } })).toBeNull();

    const alcanceCompleto = { lectura: [e.sucursalA, e.sucursalB, ajeno.sucursal.id], escritura: [e.sucursalA, e.sucursalB, ajeno.sucursal.id] };
    const b = await conexionComoApp(EMPRESA_TESTIGO_ID, alcanceCompleto);
    // Desde el testigo: solo lo suyo, aunque el alcance nombre las sucursales de la otra empresa.
    expect((await b.query(`SELECT "codigo" FROM "PlanDeCostos"`)).rows).toEqual([{ codigo: "PLAN_T" }]);
    expect((await b.query(`SELECT "codigo" FROM "CentroDeCostos"`)).rows).toEqual([{ codigo: "UN_T" }]);
    for (const tabla of ["PlanDeCostosSucursal", "DistribucionCostoVersion", "DistribucionCostoLinea"]) expect((await b.query(`SELECT 1 FROM "${tabla}"`)).rowCount, tabla).toBe(0);

    // Y no puede escribir con el empresaId de la otra.
    const ajena = { empresaId: EMPRESA_DE_PRUEBA_ID };
    expect(await probar(b, sentenciaDeInsercion("PlanDeCostos", { id: randomUUID(), codigo: "PLAN_X", nombre: "Plan X", ...ajena }))).toMatchObject({ codigo: "42501" });
    expect(await probar(b, sentenciaDeInsercion("CentroDeCostos", { id: randomUUID(), planDeCostosId: e.planId, codigo: "UN_X", nombre: "Unidad X", ...ajena }))).toMatchObject({ codigo: "42501" });
    expect(await probar(b, sentenciaDeInsercion("PlanDeCostosSucursal", { id: randomUUID(), planDeCostosId: e.planId, sucursalId: e.sucursalA, aplica: true, ...ajena }))).toMatchObject({ codigo: "42501" });
    expect(await probar(b, sentenciaDeVersion({ imputacionId: e.imputacionAId, planId: e.planId, usuarioId: e.usuarioId }, { numero: 2, motivo: "x", ...ajena }))).toMatchObject({ codigo: "42501" });
    expect(await probar(b, sentenciaDeLinea({ versionId: versionA, planId: e.planId, centroId: e.centroUnAId }, { ...ajena }))).toMatchObject({ codigo: "42501" });
  });
});
