import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { EMPRESA_DE_PRUEBA_ID, EMPRESA_TESTIGO_ID } from "../setup/empresa-de-prueba";
import { sembrarAjeno } from "../setup/factura-proveedor";
import { cerrarConexiones, conexionComoApp, intentar } from "../setup/gasto";
import { sembrarAdicional, sembrarEscenarioDeOpciones, sembrarLineaConOpciones, sentenciaDeApagado, sentenciaDeFoto, sentenciaDeGrupo, sentenciaDeLinea, type EscenarioDeOpciones } from "../setup/opciones";
import { baseDeTest, limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";

/**
 * GO-1 — la RLS de las opciones de venta, contra la base real y como `motor2_app`. Dos capas, a propósito:
 *  - El CATÁLOGO (grupos, opciones, versiones, consumos y lo que cada producto admite) es DE EMPRESA: UNA política `aislamiento_empresa` cada tabla, se ve desde cualquier sucursal (para que la sucursal B venda lo mismo que la A) y nunca desde otra empresa.
 *  - Lo que decide la SUCURSAL (`PrecioLocalDeOpcion`, `OpcionApagadaEnSucursal`: PROPIAS) y la FOTO de lo elegido (`OpcionElegidaEnLinea`: HEREDADA de la línea, y de ahí de la cuenta y de la mesa) llevan además las 4 políticas RESTRICTIVE de GO-1c-rls y GO-1d-rls: se
 *    limitan al alcance de sucursal que fija `conAlcanceEnSucursal`; sin alcance no se ve ni se escribe nada (falla cerrado; un INSERT da 42501).
 *
 * Mutaciones demostradas (ver las filas O.320 a O.328 de docs/pureza-integracion.md): sacar las políticas de GO-1d-rls (o clasificar la foto como DE_EMPRESA) deja en rojo «cada sucursal ve solo lo suyo»; cambiar un byte de la migración, el guardián B7.
 */
afterAll(() => prismaAdmin.$disconnect());

let e: EscenarioDeOpciones;
let lineaA: string;
let lineaB: string;
let adicionalA: string;
beforeEach(async () => {
  await limpiarBaseDeTest();
  e = await sembrarEscenarioDeOpciones();
  // La grilla y lo apagado de cada sucursal.
  for (const sucursalId of [e.sucursalA, e.sucursalB]) {
    await prisma.precioLocalDeOpcion.create({ data: { sucursalId, productoId: e.cafeId, opcionId: e.grandeId, precio: sucursalId === e.sucursalA ? "111.00" : "222.00" } });
    await prisma.opcionApagadaEnSucursal.create({ data: { sucursalId, opcionId: e.shotId, apagada: true, actualizadoPorId: e.usuarioId } });
  }
  // Una línea con su foto en cada sucursal (la de A, además, con un adicional y su foto).
  lineaA = (await sembrarLineaConOpciones(e.cuentaAId, e)).id;
  lineaB = (await sembrarLineaConOpciones(e.cuentaBId, e)).id;
  adicionalA = (await sembrarAdicional(e.cuentaAId, lineaA, e)).id;
  for (const cuentaItemId of [lineaA, lineaB]) {
    await prisma.opcionElegidaEnLinea.create({ data: foto(cuentaItemId) as never });
  }
});
afterEach(cerrarConexiones);

/** La foto de «De vaca» (VARIANTE sin diferencia) como datos de Prisma. */
function foto(cuentaItemId: string) {
  return { cuentaItemId, grupoId: e.grupoVarianteId, opcionId: e.vacaId, versionDeOpcionId: e.versionDe[e.vacaId], tipoGrupo: "VARIANTE", nombreGrupo: "Leche", nombreOpcion: "De vaca", importeUnitario: "0.00" };
}

const soloA = () => baseDeTest({ lectura: [e.sucursalA], escritura: [e.sucursalA] }).db;
const soloB = () => baseDeTest({ lectura: [e.sucursalB], escritura: [e.sucursalB] }).db;
const ambas = () => baseDeTest({ lectura: [e.sucursalA, e.sucursalB], escritura: [e.sucursalA, e.sucursalB] }).db;
const cuantos = async (tabla: string, filtro = "TRUE") => Number((await prismaAdmin.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM "${tabla}" WHERE ${filtro}`))[0]!.n);

const CATALOGO = ["GrupoDeOpciones", "OpcionDeGrupo", "VersionDeOpcion", "ConsumoDeOpcion", "ProductoAdmiteGrupo", "ProductoAdmiteOpcion"] as const;
const POR_SUCURSAL = ["PrecioLocalDeOpcion", "OpcionApagadaEnSucursal", "OpcionElegidaEnLinea"] as const;

describe("las políticas de las opciones de venta", () => {
  it("cada tabla del catálogo tiene UNA política (`aislamiento_empresa`); la grilla, lo apagado y la foto tienen 5: la de empresa y las 4 de sucursal (RESTRICTIVE, TO motor2_app)", async () => {
    const filas = await prismaAdmin.$queryRaw<Array<{ tabla: string; nombre: string; permissive: string; roles: string }>>`
      SELECT tablename::text AS tabla, policyname::text AS nombre, permissive, roles::text AS roles FROM pg_policies
       WHERE schemaname = 'public' AND tablename IN ('GrupoDeOpciones', 'OpcionDeGrupo', 'VersionDeOpcion', 'ConsumoDeOpcion', 'ProductoAdmiteGrupo', 'ProductoAdmiteOpcion', 'PrecioLocalDeOpcion', 'OpcionApagadaEnSucursal', 'OpcionElegidaEnLinea') ORDER BY 1, 2`;
    const de = (tabla: string) => filas.filter((f) => f.tabla === tabla);
    for (const tabla of CATALOGO) expect(de(tabla).map((f) => f.nombre), tabla).toEqual(["aislamiento_empresa"]);
    for (const tabla of POR_SUCURSAL) {
      expect(de(tabla).map((f) => f.nombre), tabla).toEqual(["aislamiento_empresa", "alcance_sucursal_delete", "alcance_sucursal_insert", "alcance_sucursal_select", "alcance_sucursal_update"]);
      for (const f of de(tabla).filter((x) => x.nombre.startsWith("alcance_sucursal_"))) expect([f.permissive, f.roles], `${tabla}.${f.nombre}`).toEqual(["RESTRICTIVE", "{motor2_app}"]);
    }
    expect(filas).toHaveLength(CATALOGO.length + POR_SUCURSAL.length * 5);
  });
});

describe("cada sucursal ve SOLO lo suyo", () => {
  it("la grilla de precios: A ve la suya (111,00), B la suya (222,00), con las dos las dos, y sin alcance (o con otra sucursal) ninguna (falla cerrado)", async () => {
    const precios = async (db: ReturnType<typeof soloA>) => (await db.precioLocalDeOpcion.findMany({ orderBy: { precio: "asc" } })).map((p) => [p.sucursalId === e.sucursalA ? "A" : "B", p.precio.toFixed(2)]);
    expect(await precios(soloA())).toEqual([["A", "111.00"]]);
    expect(await precios(soloB())).toEqual([["B", "222.00"]]);
    expect(await precios(ambas())).toEqual([["A", "111.00"], ["B", "222.00"]]);
    expect(await baseDeTest.db.precioLocalDeOpcion.findMany()).toEqual([]);
    expect(await baseDeTest({ lectura: ["otra-sucursal"], escritura: ["otra-sucursal"] }).db.precioLocalDeOpcion.findMany()).toEqual([]);
  });

  it("lo apagado: la sucursal B no ve que la A apagó el shot (ni la A lo de B); sin alcance, nada", async () => {
    expect((await soloA().opcionApagadaEnSucursal.findMany()).map((a) => a.sucursalId)).toEqual([e.sucursalA]);
    expect((await soloB().opcionApagadaEnSucursal.findMany()).map((a) => a.sucursalId)).toEqual([e.sucursalB]);
    expect(await soloA().opcionApagadaEnSucursal.findMany({ where: { sucursalId: e.sucursalB } })).toEqual([]);
    expect(await baseDeTest.db.opcionApagadaEnSucursal.findMany()).toEqual([]);
  });

  it("la foto de lo elegido: se ve solo con la sucursal de la mesa de la línea (cadena línea, cuenta y mesa); sin alcance, nada; con las dos, las tres", async () => {
    expect((await soloA().opcionElegidaEnLinea.findMany()).map((f) => f.cuentaItemId)).toEqual([lineaA]);
    expect((await soloB().opcionElegidaEnLinea.findMany()).map((f) => f.cuentaItemId)).toEqual([lineaB]);
    expect(await soloA().opcionElegidaEnLinea.findMany({ where: { cuentaItemId: lineaB } })).toEqual([]);
    expect((await ambas().opcionElegidaEnLinea.findMany()).map((f) => f.cuentaItemId).sort()).toEqual([lineaA, lineaB].sort());
    expect(await baseDeTest.db.opcionElegidaEnLinea.findMany()).toEqual([]);
    expect(await baseDeTest({ lectura: ["otra-sucursal"], escritura: ["otra-sucursal"] }).db.opcionElegidaEnLinea.findMany()).toEqual([]);
  });

  it("la línea padre y su adicional siguen la misma regla: A ve los dos, B no ve ninguno de los de A", async () => {
    expect((await soloA().cuentaItem.findMany({ where: { id: { in: [lineaA, adicionalA, lineaB] } } })).map((i) => i.id).sort()).toEqual([lineaA, adicionalA].sort());
    expect((await soloB().cuentaItem.findMany({ where: { id: { in: [lineaA, adicionalA, lineaB] } } })).map((i) => i.id)).toEqual([lineaB]);
  });
});

describe("la escritura queda dentro del alcance de escritura", () => {
  it("una foto en una línea de la sucursal B: con lectura en las dos y escritura solo en A da 42501 (row-level security); con escritura en B, entra", async () => {
    const lineaB2 = await sembrarLineaConOpciones(e.cuentaBId, e);
    const soloLeeB = await conexionComoApp(undefined, { lectura: [e.sucursalA, e.sucursalB], escritura: [e.sucursalA] });
    expect(await intentar(soloLeeB, ...pg(sentenciaDeFoto({ ...e, cuentaItemId: lineaB2.id })))).toMatchObject({ codigo: "42501" });
    expect(await cuantos("OpcionElegidaEnLinea", `"cuentaItemId" = '${lineaB2.id}'`)).toBe(0);
    const escribeB = await conexionComoApp(undefined, { lectura: [e.sucursalB], escritura: [e.sucursalB] });
    expect(await intentar(escribeB, ...pg(sentenciaDeFoto({ ...e, cuentaItemId: lineaB2.id })))).toBeNull();
    expect(await cuantos("OpcionElegidaEnLinea", `"cuentaItemId" = '${lineaB2.id}'`)).toBe(1);
  });

  it("una foto en una línea de B que la sucursal no ve (lectura solo en A) también se rechaza, antes, por el disparador (23514: la línea no se ve); nada queda escrito", async () => {
    const lineaB2 = await sembrarLineaConOpciones(e.cuentaBId, e);
    const soloA1 = await conexionComoApp(undefined, { lectura: [e.sucursalA], escritura: [e.sucursalA] });
    expect(await intentar(soloA1, ...pg(sentenciaDeFoto({ ...e, cuentaItemId: lineaB2.id })))).toMatchObject({ codigo: "23514", restriccion: "OpcionElegidaEnLinea_linea_valida_chk" });
    expect(await cuantos("OpcionElegidaEnLinea", `"cuentaItemId" = '${lineaB2.id}'`)).toBe(0);
  });

  it("un adicional colgado de una línea de OTRA sucursal que no se ve da 23514 (el padre no se ve); una línea de B no se escribe con escritura en A (42501)", async () => {
    const soloA1 = await conexionComoApp(undefined, { lectura: [e.sucursalA], escritura: [e.sucursalA] });
    const hijoDeB = sentenciaDeLinea({ cuentaId: e.cuentaBId, productoId: e.anclaDelShotId }, { precioUnitario: "200.00", lineaPadreId: lineaB });
    expect(await intentar(soloA1, hijoDeB.texto, hijoDeB.params)).toMatchObject({ codigo: "23514", restriccion: "CuentaItem_padre_misma_cuenta_chk" });
    const hijoDeBVisible = await conexionComoApp(undefined, { lectura: [e.sucursalA, e.sucursalB], escritura: [e.sucursalA] });
    const otro = sentenciaDeLinea({ cuentaId: e.cuentaBId, productoId: e.anclaDelShotId }, { precioUnitario: "200.00", lineaPadreId: lineaB });
    expect(await intentar(hijoDeBVisible, otro.texto, otro.params)).toMatchObject({ codigo: "42501" });
    expect(await cuantos("CuentaItem", `"lineaPadreId" = '${lineaB}'`)).toBe(0);
  });

  it("el apagado y la grilla de B no se escriben con escritura solo en A: INSERT y `ON CONFLICT DO UPDATE` dan 42501, y UPDATE no toca ninguna fila", async () => {
    const soloEscribeA = await conexionComoApp(undefined, { lectura: [e.sucursalA, e.sucursalB], escritura: [e.sucursalA] });
    const apagarEnB = sentenciaDeApagado({ sucursalId: e.sucursalB, opcionId: e.chicoId, usuarioId: e.usuarioId });
    expect(await intentar(soloEscribeA, apagarEnB.texto, apagarEnB.params)).toMatchObject({ codigo: "42501" });
    expect(
      await intentar(
        soloEscribeA,
        `INSERT INTO "OpcionApagadaEnSucursal" ("id", "sucursalId", "opcionId", "apagada", "actualizadoPorId") VALUES ($1, $2, $3, false, $4)
         ON CONFLICT ("sucursalId", "opcionId") DO UPDATE SET "apagada" = EXCLUDED."apagada"`,
        [randomUUID(), e.sucursalB, e.shotId, e.usuarioId],
      ),
    ).toMatchObject({ codigo: "42501" });
    const r = await soloEscribeA.query(`UPDATE "PrecioLocalDeOpcion" SET "precio" = 1.00 WHERE "sucursalId" = $1`, [e.sucursalB]);
    expect(r.rowCount, "una fila que no se puede escribir no se ve para el UPDATE").toBe(0);
    expect((await prismaAdmin.precioLocalDeOpcion.findFirstOrThrow({ where: { sucursalId: e.sucursalB } })).precio.toFixed(2)).toBe("222.00");
    expect((await prismaAdmin.opcionApagadaEnSucursal.findFirstOrThrow({ where: { sucursalId: e.sucursalB, opcionId: e.shotId } })).apagada).toBe(true);
  });

  it("con lectura en A pero escritura en B no se puede insertar el precio de A, y sin alcance de escritura tampoco", async () => {
    const datos = { sucursalId: e.sucursalA, productoId: e.cafeId, opcionId: e.chicoId, precio: "50.00" };
    await expect(baseDeTest({ lectura: [e.sucursalA], escritura: [e.sucursalB] }).db.precioLocalDeOpcion.create({ data: datos })).rejects.toThrow(/row-level security|violates/i);
    await expect(baseDeTest.db.precioLocalDeOpcion.create({ data: datos })).rejects.toThrow(/row-level security|violates/i);
    await expect(soloA().precioLocalDeOpcion.create({ data: datos })).resolves.toMatchObject({ sucursalId: e.sucursalA });
  });
});

describe("el catálogo es de la empresa: se ve desde cualquier sucursal y nunca desde otra empresa", () => {
  it("los grupos, las opciones, las versiones, los consumos y lo que cada producto admite se ven desde A, desde B, desde las dos y sin alcance", async () => {
    for (const [nombre, db] of [["A", soloA()], ["B", soloB()], ["las dos", ambas()], ["sin alcance", baseDeTest.db]] as const) {
      expect((await db.grupoDeOpciones.findMany()).length, `grupos desde ${nombre}`).toBe(4);
      expect((await db.opcionDeGrupo.findMany()).length, `opciones desde ${nombre}`).toBe(7);
      expect((await db.versionDeOpcion.findMany()).length, `versiones desde ${nombre}`).toBe(7);
      expect((await db.consumoDeOpcion.findMany()).length, `consumos desde ${nombre}`).toBe(1);
      expect((await db.productoAdmiteGrupo.findMany()).length, `grupos admitidos desde ${nombre}`).toBe(4);
      expect((await db.productoAdmiteOpcion.findMany()).length, `opciones admitidas desde ${nombre}`).toBe(7);
    }
  });

  it("la otra empresa no ve nada de esto, con ningún alcance, y no puede escribir con el empresaId de ésta", async () => {
    const ajeno = await sembrarAjeno(e.usuarioId);
    await ajeno.testigo.grupoDeOpciones.create({ data: { nombre: "Grupo testigo", tipo: "VARIANTE" } });
    const comoB = await conexionComoApp(EMPRESA_TESTIGO_ID, { lectura: [e.sucursalA, e.sucursalB, ajeno.sucursal.id], escritura: [e.sucursalA, e.sucursalB, ajeno.sucursal.id] });
    for (const tabla of [...CATALOGO, ...POR_SUCURSAL]) {
      const r = await comoB.query<{ n: string }>(`SELECT count(*) AS n FROM "${tabla}"`);
      expect(Number(r.rows[0]!.n), `la empresa testigo ve ${tabla} de la principal`).toBe(tabla === "GrupoDeOpciones" ? 1 : 0);
    }
    const g = sentenciaDeGrupo({ empresaId: EMPRESA_DE_PRUEBA_ID });
    expect(await intentar(comoB, g.texto, g.params)).toMatchObject({ codigo: "42501" });
    const f = sentenciaDeApagado({ sucursalId: ajeno.sucursal.id, opcionId: e.shotId, usuarioId: e.usuarioId }, { empresaId: EMPRESA_DE_PRUEBA_ID });
    expect(await intentar(comoB, f.texto, f.params)).toMatchObject({ codigo: "42501" });
    expect(await cuantos("OpcionApagadaEnSucursal")).toBe(2);
    expect((await ambas().grupoDeOpciones.findMany()).map((g2) => g2.nombre).includes("Grupo testigo")).toBe(false);
  });
});

/** Los dos argumentos de `intentar` a partir de una sentencia armada con las ayudas de `test/setup/opciones.ts`. */
function pg(s: { texto: string; params: unknown[] }): [string, unknown[]] {
  return [s.texto, s.params];
}
