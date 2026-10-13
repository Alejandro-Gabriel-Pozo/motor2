import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { EMPRESA_DE_PRUEBA_ID, EMPRESA_TESTIGO_ID } from "../setup/empresa-de-prueba";
import { sembrarAjeno } from "../setup/factura-proveedor";
import { cerrarConexiones, conexionComoApp, intentar } from "../setup/gasto";
import { datosDeImputacion, datosDeLinea, datosDeLineaDeGasto, datosDeNota, datosDeTributo, sembrarEscenarioDeNota, sentenciaDeInsercion, type EscenarioDeNota } from "../setup/nota-credito";
import { baseDeTest, limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";

/**
 * Paquete 4, M6.1 y M6.2 — la RLS de la nota de crédito de proveedor, contra la base real y como `motor2_app`. Dos capas, a propósito (igual que el gasto):
 *  - La CABECERA, las LÍNEAS y los TRIBUTOS son DE EMPRESA: se ven desde cualquier sucursal (y sin alcance de sucursal) y nunca desde otra empresa. Consecuencia aceptada: una nota imputada solo a la sucursal B se ve entera (importes
 *    incluidos) desde la A; lo que se MUESTRA lo decide el gate, con piso administrador.
 *  - La IMPUTACIÓN (`NotaCreditoProveedorImputacion`) es PROPIA: las 4 políticas RESTRICTIVE de M6.2 la limitan al alcance de sucursal que fija `conAlcanceEnSucursal`; sin alcance no se ve ni se escribe ninguna (falla cerrado; un INSERT da 42501).
 *
 * Mutaciones demostradas (ver las filas O.286 a O.299 de docs/pureza-integracion.md): sacar el `ENABLE ROW LEVEL SECURITY` de la imputación, sacar las políticas de la migración M6.2 (o clasificar la tabla como DE_EMPRESA), cambiar un byte de M6.2 (el guardián B7).
 */
afterAll(() => prismaAdmin.$disconnect());

let e: EscenarioDeNota;
/** La nota del escenario: una línea de mercadería imputada a la A (30,00) y a la B (20,00), una de gasto imputada solo a la B (100,00) y un tributo. */
let notaId: string;
let lineaMercaderiaId: string;
let lineaGastoId: string;
let imputacionMercaderiaA: string;
let imputacionMercaderiaB: string;
let imputacionGastoB: string;
let tributoId: string;
const hayRol = async (rol: string) => ((await prismaAdmin.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM pg_roles WHERE rolname = ${rol}`)[0]!.n) === BigInt(1);

beforeEach(async () => {
  await limpiarBaseDeTest();
  e = await sembrarEscenarioDeNota();
  notaId = (await prisma.notaCreditoProveedor.create({ data: datosDeNota(e, { importeTotal: "155.00" }) as never })).id;
  lineaMercaderiaId = (await prisma.notaCreditoProveedorLinea.create({ data: datosDeLinea(e, notaId, { importe: "50.00" }) as never })).id;
  lineaGastoId = (await prisma.notaCreditoProveedorLinea.create({ data: datosDeLineaDeGasto(e, notaId, { importe: "100.00" }) as never })).id;
  imputacionMercaderiaA = (await prisma.notaCreditoProveedorImputacion.create({ data: datosDeImputacion(e, lineaMercaderiaId, { importe: "30.00" }) as never })).id;
  imputacionMercaderiaB = (await prisma.notaCreditoProveedorImputacion.create({ data: datosDeImputacion(e, lineaMercaderiaId, { sucursalId: e.sucursalB, importe: "20.00" }) as never })).id;
  imputacionGastoB = (await prisma.notaCreditoProveedorImputacion.create({ data: datosDeImputacion(e, lineaGastoId, { lineaAdmiteDevolucion: false, sucursalId: e.sucursalB, importe: "100.00" }) as never })).id;
  tributoId = (await prisma.notaCreditoProveedorTributo.create({ data: datosDeTributo(notaId, { importe: "5.00" }) as never })).id;
});
afterEach(cerrarConexiones);

const soloA = () => baseDeTest({ lectura: [e.sucursalA], escritura: [e.sucursalA] }).db;
const soloB = () => baseDeTest({ lectura: [e.sucursalB], escritura: [e.sucursalB] }).db;
const ambas = () => baseDeTest({ lectura: [e.sucursalA, e.sucursalB], escritura: [e.sucursalA, e.sucursalB] }).db;

/** La nota de la empresa TESTIGO, con una línea, una imputación y un tributo, para probar que nada cruza. */
async function sembrarNotaAjena() {
  const ajeno = await sembrarAjeno(e.usuarioId);
  const datosAjenos = { facturaId: ajeno.factura.id, proveedorId: ajeno.proveedor.id, usuarioId: e.usuarioId };
  const nota = await ajeno.testigo.notaCreditoProveedor.create({ data: datosDeNota(datosAjenos) as never });
  const linea = await ajeno.testigo.notaCreditoProveedorLinea.create({ data: datosDeLinea({ facturaId: ajeno.factura.id, renglonMercaderiaId: ajeno.renglon.id }, nota.id) as never });
  const imputacion = await ajeno.testigo.notaCreditoProveedorImputacion.create({ data: datosDeImputacion({ sucursalA: ajeno.sucursal.id }, linea.id, { importe: "55.00" }) as never });
  const tributo = await ajeno.testigo.notaCreditoProveedorTributo.create({ data: datosDeTributo(nota.id, { importe: "1.00" }) as never });
  return { ajeno, nota, linea, imputacion, tributo };
}

describe("la imputación: cada sucursal ve SOLO lo suyo (las 4 políticas de sucursal de M6.2)", () => {
  it("cada sucursal ve SOLO lo que le tocó; con las dos, las tres; sin alcance, ninguna (falla cerrado); con una sucursal ajena, ninguna", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    expect((await soloA().notaCreditoProveedorImputacion.findMany()).map((i) => i.id)).toEqual([imputacionMercaderiaA]);
    expect((await soloB().notaCreditoProveedorImputacion.findMany()).map((i) => i.id).sort()).toEqual([imputacionMercaderiaB, imputacionGastoB].sort());
    expect((await ambas().notaCreditoProveedorImputacion.findMany()).map((i) => i.id).sort()).toEqual([imputacionMercaderiaA, imputacionMercaderiaB, imputacionGastoB].sort());
    expect(await baseDeTest.db.notaCreditoProveedorImputacion.findMany()).toEqual([]);
    expect(await baseDeTest({ lectura: ["otra-sucursal"], escritura: ["otra-sucursal"] }).db.notaCreditoProveedorImputacion.findMany()).toEqual([]);
  });

  it("lo que ve una sola sucursal es SU parte del dinero: A ve 30,00 de la línea de mercadería y no ve los 20,00 de B ni los 100,00 del gasto", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    expect((await soloA().notaCreditoProveedorImputacion.findMany()).map((i) => i.importe.toFixed(2))).toEqual(["30.00"]);
    const deB = await soloB().notaCreditoProveedorImputacion.aggregate({ _sum: { importe: true }, _count: true });
    expect([deB._sum.importe?.toFixed(2), deB._count]).toEqual(["120.00", 2]);
  });

  it("una imputación de la sucursal B no se puede escribir con escritura solo en A (INSERT da 42501); con lectura en A pero escritura en B, la de A tampoco; sin alcance de escritura, ninguna", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const otraLinea = await prisma.notaCreditoProveedorLinea.create({ data: datosDeLinea(e, notaId, { orden: 3 }) as never });
    const deB = datosDeImputacion(e, otraLinea.id, { sucursalId: e.sucursalB }) as never;
    await expect(soloA().notaCreditoProveedorImputacion.create({ data: deB })).rejects.toThrow(/row-level security|violates/i);
    const cliente = await conexionComoApp(undefined, { lectura: [e.sucursalA], escritura: [e.sucursalA] });
    const s = sentenciaDeInsercion("NotaCreditoProveedorImputacion", datosDeImputacion(e, otraLinea.id, { sucursalId: e.sucursalB }));
    expect(await intentar(cliente, s.texto, s.params)).toMatchObject({ codigo: "42501" });
    expect(await prismaAdmin.notaCreditoProveedorImputacion.count({ where: { notaCreditoProveedorLineaId: otraLinea.id } })).toBe(0);
    const deA = datosDeImputacion(e, otraLinea.id, { sucursalId: e.sucursalA }) as never;
    await expect(baseDeTest({ lectura: [e.sucursalA], escritura: [e.sucursalB] }).db.notaCreditoProveedorImputacion.create({ data: deA })).rejects.toThrow(/row-level security|violates/i);
    await expect(baseDeTest.db.notaCreditoProveedorImputacion.create({ data: deA })).rejects.toThrow(/row-level security|violates/i);
    await soloA().notaCreditoProveedorImputacion.create({ data: deA });
    expect(await prismaAdmin.notaCreditoProveedorImputacion.count({ where: { notaCreditoProveedorLineaId: otraLinea.id } })).toBe(1);
  });

  it("aun con alcance propio, UPDATE y DELETE de la imputación dan permission denied (solo se agrega)", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    await expect(soloA().notaCreditoProveedorImputacion.delete({ where: { id: imputacionMercaderiaA } })).rejects.toThrow(/permission denied/i);
    await expect(soloA().notaCreditoProveedorImputacion.update({ where: { id: imputacionMercaderiaA }, data: { importe: "1.00" } })).rejects.toThrow(/permission denied/i);
    expect((await prismaAdmin.notaCreditoProveedorImputacion.findUniqueOrThrow({ where: { id: imputacionMercaderiaA } })).importe.toFixed(2)).toBe("30.00");
  });
});

describe("la cabecera, las líneas y los tributos son DE EMPRESA: se ven desde cualquier sucursal, y sin alcance también (consecuencia aceptada)", () => {
  it("una nota imputada solo a la B (y a la A en una línea) se ve ENTERA desde la A, desde la B, desde las dos y sin alcance de sucursal: cabecera, líneas y tributo, con sus importes", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    for (const db of [soloA(), soloB(), ambas(), baseDeTest.db]) {
      expect((await db.notaCreditoProveedor.findMany()).map((n) => [n.id, n.importeTotal.toFixed(2)])).toEqual([[notaId, "155.00"]]);
      expect((await db.notaCreditoProveedorLinea.findMany({ orderBy: { orden: "asc" } })).map((l) => [l.id, l.importe.toFixed(2)])).toEqual([[lineaMercaderiaId, "50.00"], [lineaGastoId, "100.00"]]);
      expect((await db.notaCreditoProveedorTributo.findMany()).map((t) => t.id)).toEqual([tributoId]);
    }
    // La línea del gasto, imputada solo a la B, es visible desde la A aunque su imputación no.
    const desdeA = await soloA().notaCreditoProveedorLinea.findUniqueOrThrow({ where: { id: lineaGastoId }, include: { imputaciones: true } });
    expect([desdeA.importe.toFixed(2), desdeA.imputaciones]).toEqual(["100.00", []]);
  });

  it("anular una nota (UPDATE por columna) anda desde cualquier sucursal con alcance de escritura, aunque la nota esté imputada a otra: la política de la cabecera es solo la de empresa", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const app = await conexionComoApp(EMPRESA_DE_PRUEBA_ID, { lectura: [e.sucursalA], escritura: [e.sucursalA] });
    const r = await app.query(`UPDATE "NotaCreditoProveedor" SET "anuladaEn" = now(), "anuladaPorId" = $2, "motivoAnulacion" = 'Cargada por error' WHERE "id" = $1 AND "anuladaEn" IS NULL`, [notaId, e.usuarioId]);
    expect(r.rowCount).toBe(1);
  });
});

describe("la otra empresa no ve nada, ni escribe en esta", () => {
  it("como motor2_app de la empresa B no se ve ninguna fila de A en las cuatro tablas (aunque el alcance nombre sus sucursales), y se ven las propias", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const { ajeno } = await sembrarNotaAjena();
    const b = await conexionComoApp(EMPRESA_TESTIGO_ID, { lectura: [e.sucursalA, e.sucursalB, ajeno.sucursal.id], escritura: [e.sucursalA, e.sucursalB, ajeno.sucursal.id] });
    const propias = async (tabla: string, columna: string) => (await b.query(`SELECT "${columna}"::text AS valor FROM "${tabla}"`)).rows.map((f) => f.valor);
    expect(await propias("NotaCreditoProveedor", "importeTotal")).toEqual(["100.00"]);
    expect(await propias("NotaCreditoProveedorLinea", "importe")).toEqual(["50.00"]);
    expect(await propias("NotaCreditoProveedorImputacion", "importe")).toEqual(["55.00"]);
    expect(await propias("NotaCreditoProveedorTributo", "importe")).toEqual(["1.00"]);
    // Y desde A no se ve nada de la B.
    expect((await ambas().notaCreditoProveedor.findMany()).map((n) => n.id)).toEqual([notaId]);
    expect(await ambas().notaCreditoProveedorTributo.count()).toBe(1);
    expect(await ambas().notaCreditoProveedorImputacion.count()).toBe(3);
  });

  it("un INSERT con el empresaId de A desde la conexión de B da 42501 en las cuatro tablas, con filas válidas para A; y la anulación de una nota de A desde B no toca ninguna fila", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const { ajeno } = await sembrarNotaAjena();
    const b = await conexionComoApp(EMPRESA_TESTIGO_ID, { lectura: [e.sucursalA, e.sucursalB, ajeno.sucursal.id], escritura: [e.sucursalA, e.sucursalB, ajeno.sucursal.id] });
    const deA = { empresaId: EMPRESA_DE_PRUEBA_ID };
    const filas: Array<[Parameters<typeof sentenciaDeInsercion>[0], Record<string, unknown>]> = [
      ["NotaCreditoProveedor", { ...deA, ...datosDeNota(e) }],
      ["NotaCreditoProveedorLinea", { ...deA, ...datosDeLinea(e, notaId, { orden: 9 }) }],
      ["NotaCreditoProveedorImputacion", { ...deA, ...datosDeImputacion(e, lineaGastoId, { lineaAdmiteDevolucion: false, sucursalId: e.sucursalA, importe: "10.00" }) }],
      ["NotaCreditoProveedorTributo", { ...deA, ...datosDeTributo(notaId) }],
    ];
    for (const [tabla, datos] of filas) {
      const s = sentenciaDeInsercion(tabla, datos);
      expect(await intentar(b, s.texto, s.params), tabla).toMatchObject({ codigo: "42501" });
    }
    const r = await b.query(`UPDATE "NotaCreditoProveedor" SET "anuladaEn" = now(), "anuladaPorId" = $2, "motivoAnulacion" = 'No es mía' WHERE "id" = $1`, [notaId, e.usuarioId]);
    expect(r.rowCount).toBe(0);
    expect(await prismaAdmin.notaCreditoProveedor.count({ where: { anuladaEn: null } })).toBe(2);
  });
});
