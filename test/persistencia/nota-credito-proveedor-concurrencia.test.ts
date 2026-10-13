import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { calcularPayloadHash, decidirIdempotencia, MENSAJE_CONFLICTO_IDEMPOTENCIA } from "../../src/core/movimientos/idempotencia";
import { EMPRESA_DE_PRUEBA_ID } from "../setup/empresa-de-prueba";
import { datosDeRenglon } from "../setup/factura-proveedor";
import { cerrarConexiones, conexionComoApp, esperarBloqueo, intentar, pidDe } from "../setup/gasto";
import {
  acreditadoDelRenglon, anularFacturaEnCurso, anularFacturaSinNotas, bloquearFactura, cargarNotaConTope, datosDeImputacion, datosDeLinea, datosDeLineaDeGasto, datosDeNota, datosDeTributo,
  insertarNotaConUnaLinea, sembrarDevolucion, sembrarEscenarioDeNota, sentenciaDeInsercion, type EscenarioDeNota,
} from "../setup/nota-credito";
import { limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";

/**
 * Paquete 4, M6 — la nota de crédito de proveedor bajo concurrencia, contra la base real y como `motor2_app` (varios clientes `pg` a la vez, cada uno en su conexión; se corre 3 veces seguidas para descartar inestabilidad).
 *
 * Qué se mide: (1) UNA ganadora por número vigente cuando varios cargan a la vez (la decide el único parcial de la base, no una lectura previa; las demás reciben 23505 y la segunda ESPERA a la primera); (2) la idempotencia (la clave es única GLOBAL: repetida,
 * simultánea o en otra nota da 23505, y la fila guardada reproduce el mensaje con `decidirIdempotencia`); (3) la anulación concurrente (el `UPDATE … WHERE "anuladaEn" IS NULL` deja una ganadora, y el bloque entero —nota, devolución anulada y su reversión—
 * deja UNA sola reversión); (4) EL TOPE con el candado `FOR UPDATE` sobre la fila de la factura (Decisión 5): con el protocolo no se acredita de más, y un CONTROL NEGATIVO sin el candado demuestra que la base sola no lo frena; (5) que la anulación de la
 * factura (C29) y la carga de una nota se serializan con el mismo candado, en los dos órdenes; (6) la misma devolución acreditada en dos notas a la vez: una gana; (7) la atomicidad (todo el bloque o nada, en seis tablas); y (8) los privilegios del candado.
 *
 * Mutaciones demostradas (ver las filas O.286 a O.299 de docs/pureza-integracion.md): quitar el `FOR UPDATE` del protocolo, sacar el único parcial del número, sacar el único de la clave de idempotencia y sacar el único de la devolución.
 */
afterAll(() => prismaAdmin.$disconnect());

const UNICO_NUMERO = "NotaCreditoProveedor_unica_vigente_key";
const UNICO_CLAVE = "NotaCreditoProveedor_claveIdempotencia_key";
const UNICO_DEVOLUCION = "NotaCreditoProveedorImputacion_devolucion_key";
const UNICO_REVERSION = "Operacion_empresaId_revierteAOperacionId_key";
const NUMERO = "0001-00000099";
const hayRol = async (rol: string) => ((await prismaAdmin.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM pg_roles WHERE rolname = ${rol}`)[0]!.n) === BigInt(1);

let e: EscenarioDeNota;
beforeEach(async () => {
  await limpiarBaseDeTest();
  e = await sembrarEscenarioDeNota();
});
afterEach(cerrarConexiones);

const alcance = () => ({ lectura: [e.sucursalA, e.sucursalB], escritura: [e.sucursalA, e.sucursalB] });
const clientes = (cuantos: number) => Promise.all(Array.from({ length: cuantos }, () => conexionComoApp(EMPRESA_DE_PRUEBA_ID, alcance())));
const cuantas = async (tabla: string, filtro = "TRUE") => Number((await prismaAdmin.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM "${tabla}" WHERE ${filtro}`))[0]!.n);
/** El INSERT de una nota SUELTA con el número fijo (cada cliente trae su clave de idempotencia). */
const sentenciaDeNotaSuelta = (extra: Record<string, unknown> = {}) =>
  sentenciaDeInsercion("NotaCreditoProveedor", datosDeNota(e, { tipo: "SUELTA", facturaProveedorId: null, nroComprobante: NUMERO, nroComprobanteNormalizado: NUMERO, ...extra }));
/** Un renglón de mercadería de 200,00 en la factura del escenario: el tope de las pruebas del candado. */
const renglonDe200 = async () =>
  (await prisma.facturaProveedorRenglon.create({ data: datosDeRenglon({ facturaProveedorId: e.facturaId, productoId: e.productoId }, { orden: 5, cantidadStock: "20", precioPorUnidadStock: "10", detalle: "20 kg", precioTotal: "200.00" }) as never })).id;
const acreditadoEnSql = async (renglonId: string) =>
  (await prismaAdmin.$queryRaw<Array<{ s: string | null }>>`SELECT sum("importe")::text AS s FROM "NotaCreditoProveedorLinea" WHERE "facturaProveedorRenglonId" = ${renglonId}`)[0]!.s;

describe("una ganadora por número vigente: cargar a la vez la misma nota no duplica", () => {
  it("dos clientes a la vez con el mismo número y claves DISTINTAS: exactamente uno confirma y el otro recibe 23505 sobre el único parcial del número", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const [a, b] = await clientes(2);
    const s1 = sentenciaDeNotaSuelta();
    const s2 = sentenciaDeNotaSuelta();
    const resultados = await Promise.all([intentar(a!, s1.texto, s1.params), intentar(b!, s2.texto, s2.params)]);
    expect(resultados.filter((r) => r === null)).toHaveLength(1);
    expect(resultados.filter((r) => r !== null)).toEqual([{ codigo: "23505", restriccion: UNICO_NUMERO }]);
    expect(await cuantas("NotaCreditoProveedor")).toBe(1);
  });

  it("ocho clientes a la vez: una sola nota queda guardada y las otras siete reciben 23505", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const todos = await clientes(8);
    const resultados = await Promise.all(todos.map((c) => { const s = sentenciaDeNotaSuelta(); return intentar(c, s.texto, s.params); }));
    expect(resultados.filter((r) => r === null)).toHaveLength(1);
    expect(resultados.filter((r) => r?.codigo === "23505" && r.restriccion === UNICO_NUMERO)).toHaveLength(7);
    expect(await cuantas("NotaCreditoProveedor")).toBe(1);
  });

  it("el segundo INSERT ESPERA al primero: si éste hace ROLLBACK, entra; si CONFIRMA, recibe 23505", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const [a, b] = await clientes(2);
    const pidDeB = await pidDe(b!);
    // 1) ROLLBACK de la primera: la segunda, que esperaba, entra.
    await a!.query("BEGIN");
    const primera = sentenciaDeNotaSuelta();
    await a!.query(primera.texto, primera.params);
    await b!.query("BEGIN");
    const segunda = sentenciaDeNotaSuelta();
    const esperando = b!.query(segunda.texto, segunda.params);
    await esperarBloqueo(pidDeB);
    await a!.query("ROLLBACK");
    expect((await esperando).rowCount).toBe(1);
    await b!.query("COMMIT");
    expect(await cuantas("NotaCreditoProveedor")).toBe(1);
    // 2) COMMIT de la primera, sobre otro número: la segunda, que esperaba, pierde.
    await a!.query("BEGIN");
    const tercera = sentenciaDeNotaSuelta({ nroComprobante: "0001-00000100", nroComprobanteNormalizado: "0001-00000100" });
    await a!.query(tercera.texto, tercera.params);
    await b!.query("BEGIN");
    const cuarta = sentenciaDeNotaSuelta({ nroComprobante: "0001-00000100", nroComprobanteNormalizado: "0001-00000100" });
    const perdedora = b!.query(cuarta.texto, cuarta.params).then(() => "entró" as const, (error: { code?: string; constraint?: string }) => `${error.code}|${error.constraint}`);
    await esperarBloqueo(pidDeB);
    await a!.query("COMMIT");
    expect(await perdedora).toBe(`23505|${UNICO_NUMERO}`);
    await b!.query("ROLLBACK");
    expect(await cuantas("NotaCreditoProveedor")).toBe(2);
  });

  it("otro proveedor, otra letra o un número distinto NO se estorban; y una nota anulada libera el número para que otro cliente lo tome", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const otro = await prisma.proveedor.create({ data: { codigo: "PRV_2", nombre: "Otro proveedor" } });
    const todos = await clientes(5);
    const sentencias = [sentenciaDeNotaSuelta(), sentenciaDeNotaSuelta({ proveedorId: otro.id }), sentenciaDeNotaSuelta({ letra: "A" }), sentenciaDeNotaSuelta({ letra: "B" }), sentenciaDeNotaSuelta({ nroComprobante: "0001-00000101", nroComprobanteNormalizado: "0001-00000101" })];
    expect(await Promise.all(sentencias.map((s, i) => intentar(todos[i]!, s.texto, s.params)))).toEqual([null, null, null, null, null]);
    const anulada = await prisma.notaCreditoProveedor.findFirstOrThrow({ where: { nroComprobanteNormalizado: NUMERO, letra: null, proveedorId: e.proveedorId } });
    const app = todos[0]!;
    expect(await intentar(app, `UPDATE "NotaCreditoProveedor" SET "anuladaEn" = now(), "anuladaPorId" = $2, "motivoAnulacion" = 'Mal cargada' WHERE "id" = $1 AND "anuladaEn" IS NULL`, [anulada.id, e.usuarioId])).toBeNull();
    const reemplazo = sentenciaDeNotaSuelta();
    expect(await intentar(todos[1]!, reemplazo.texto, reemplazo.params)).toBeNull();
    expect(await cuantas("NotaCreditoProveedor", `"nroComprobanteNormalizado" = '${NUMERO}'`)).toBe(5);
  });
});

describe("idempotencia: la clave es única GLOBAL y la fila guardada reproduce el resultado", () => {
  it("la misma clave dos veces seguidas: queda UNA fila y el segundo intento da 23505 sobre el único de la clave (aunque el número sea otro)", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const app = await conexionComoApp(EMPRESA_DE_PRUEBA_ID, alcance());
    const clave = randomUUID();
    const primera = sentenciaDeNotaSuelta({ claveIdempotencia: clave });
    expect(await intentar(app, primera.texto, primera.params)).toBeNull();
    const repetida = sentenciaDeNotaSuelta({ claveIdempotencia: clave, nroComprobante: "0001-00000100", nroComprobanteNormalizado: "0001-00000100" });
    expect(await intentar(app, repetida.texto, repetida.params)).toEqual({ codigo: "23505", restriccion: UNICO_CLAVE });
    expect(await cuantas("NotaCreditoProveedor")).toBe(1);
  });

  it("la misma clave a la vez (2 y 8 clientes): queda UNA fila; el que pierde choca contra uno de los dos únicos", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    for (const cuantos of [2, 8]) {
      await prismaAdmin.$executeRawUnsafe(`DELETE FROM "NotaCreditoProveedor"`);
      const todos = await clientes(cuantos);
      const clave = randomUUID();
      const resultados = await Promise.all(todos.map((c) => { const s = sentenciaDeNotaSuelta({ claveIdempotencia: clave }); return intentar(c, s.texto, s.params); }));
      expect(resultados.filter((r) => r === null), `${cuantos} clientes`).toHaveLength(1);
      const perdedoras = resultados.filter((r) => r !== null);
      expect(perdedoras, `${cuantos} clientes`).toHaveLength(cuantos - 1);
      for (const p of perdedoras) {
        expect(p!.codigo).toBe("23505");
        expect([UNICO_NUMERO, UNICO_CLAVE]).toContain(p!.restriccion);
      }
      expect(await cuantas("NotaCreditoProveedor"), `${cuantos} clientes`).toBe(1);
    }
  });

  it("la misma clave en OTRA nota (otro proveedor y otro número) da 23505: la clave es global, no por proveedor", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const app = await conexionComoApp(EMPRESA_DE_PRUEBA_ID, alcance());
    const otro = await prisma.proveedor.create({ data: { codigo: "PRV_2", nombre: "Otro proveedor" } });
    const clave = randomUUID();
    const primera = sentenciaDeNotaSuelta({ claveIdempotencia: clave });
    expect(await intentar(app, primera.texto, primera.params)).toBeNull();
    const enOtra = sentenciaDeNotaSuelta({ claveIdempotencia: clave, proveedorId: otro.id, nroComprobante: "0009-00000001", nroComprobanteNormalizado: "0009-00000001" });
    expect(await intentar(app, enOtra.texto, enOtra.params)).toEqual({ codigo: "23505", restriccion: UNICO_CLAVE });
    expect(await cuantas("NotaCreditoProveedor")).toBe(1);
  });

  it("al repetir, la fila guardada alcanza para `decidirIdempotencia`: misma huella, `duplicado` con el mensaje original; otra huella, `conflicto`; sin fila, `nueva`", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const app = await conexionComoApp(EMPRESA_DE_PRUEBA_ID, alcance());
    const clave = randomUUID();
    const huella = calcularPayloadHash("nota-credito-proveedor", e.sucursalA, { facturaId: e.facturaId, renglonId: e.renglonMercaderiaId, importe: "50.00", motivo: "Rotura" });
    const mensaje = "Nota de crédito registrada.";
    const s = sentenciaDeNotaSuelta({ claveIdempotencia: clave, payloadHash: huella, resultadoMensaje: mensaje });
    expect(await intentar(app, s.texto, s.params)).toBeNull();

    const leer = async (c: string) => (await app.query<{ payloadHash: string; resultadoMensaje: string }>(`SELECT "payloadHash", "resultadoMensaje" FROM "NotaCreditoProveedor" WHERE "claveIdempotencia" = $1`, [c])).rows[0] ?? null;
    expect(decidirIdempotencia(await leer(clave), huella)).toEqual({ estado: "duplicado", mensaje });
    const otraHuella = calcularPayloadHash("nota-credito-proveedor", e.sucursalA, { facturaId: e.facturaId, renglonId: e.renglonMercaderiaId, importe: "60.00", motivo: "Rotura" });
    expect(decidirIdempotencia(await leer(clave), otraHuella)).toEqual({ estado: "conflicto" });
    expect(MENSAJE_CONFLICTO_IDEMPOTENCIA).toMatch(/datos distintos/);
    expect(decidirIdempotencia(await leer(randomUUID()), huella)).toEqual({ estado: "nueva" });
  });
});

describe("anulación concurrente: una ganadora, y una sola reversión de la devolución", () => {
  const MOTIVO = "Cargada por error";
  /** Una nota sobre la factura, con una línea de mercadería imputada a la A con una devolución acreditada. Devuelve la nota y la `Operacion` de la devolución. */
  async function notaConDevolucion() {
    const devolucion = await sembrarDevolucion(e, "A", 2);
    const nota = await prisma.notaCreditoProveedor.create({ data: datosDeNota(e, { importeTotal: "50.00" }) as never });
    const linea = await prisma.notaCreditoProveedorLinea.create({ data: datosDeLinea(e, nota.id) as never });
    await prisma.notaCreditoProveedorImputacion.create({ data: datosDeImputacion(e, linea.id, { operacionDevolucionId: devolucion.operacionId, cantidadStock: "2" }) as never });
    return { notaId: nota.id, devolucionId: devolucion.operacionId };
  }
  /** El bloque de anular una nota (UNA transacción): la nota por columna, la devolución que acreditaba, y su reversión (`AJUSTE` que apunta a la devolución). Si la nota ya estaba anulada, no toca nada («0 filas»). */
  async function anular(c: Client, notaId: string, devolucionId: string): Promise<"ok" | "0 filas" | string> {
    try {
      await c.query("BEGIN");
      const nota = await c.query(`UPDATE "NotaCreditoProveedor" SET "anuladaEn" = now(), "anuladaPorId" = $2, "motivoAnulacion" = $3 WHERE "id" = $1 AND "anuladaEn" IS NULL`, [notaId, e.usuarioId, MOTIVO]);
      if (nota.rowCount === 0) {
        await c.query("ROLLBACK");
        return "0 filas";
      }
      await c.query(`UPDATE "Operacion" SET "anuladaEn" = now(), "anuladaPorId" = $2, "motivoAnulacion" = $3 WHERE "id" = $1 AND "anuladaEn" IS NULL`, [devolucionId, e.usuarioId, MOTIVO]);
      await c.query(`INSERT INTO "Operacion" ("id","sucursalId","fecha","usuarioId","proceso","revierteAOperacionId") VALUES ($1,$2,now(),$3,'AJUSTE',$4)`, [randomUUID(), e.sucursalA, e.usuarioId, devolucionId]);
      await c.query("COMMIT");
      return "ok";
    } catch (error) {
      await c.query("ROLLBACK").catch(() => undefined);
      return `${(error as { code?: string }).code}|${(error as { constraint?: string }).constraint}`;
    }
  }

  it("ocho `UPDATE … WHERE anuladaEn IS NULL` a la vez: exactamente UNO toca la fila (rowCount = 1) y la nota queda anulada una sola vez", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const { notaId } = await notaConDevolucion();
    const todos = await clientes(8);
    const resultados = await Promise.all(todos.map((c, i) => c.query(`UPDATE "NotaCreditoProveedor" SET "anuladaEn" = now(), "anuladaPorId" = $2, "motivoAnulacion" = $3 WHERE "id" = $1 AND "anuladaEn" IS NULL`, [notaId, e.usuarioId, `Anulación ${i}`])));
    expect(resultados.map((r) => r.rowCount).sort()).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(await cuantas("NotaCreditoProveedor", `"anuladaEn" IS NOT NULL`)).toBe(1);
  });

  it("el bloque completo (nota, devolución anulada y su reversión) dos veces a la vez deja UNA sola reversión: el perdedor toca 0 filas y no deja nada", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const { notaId, devolucionId } = await notaConDevolucion();
    const [a, b] = await clientes(2);
    const resultados = await Promise.all([anular(a!, notaId, devolucionId), anular(b!, notaId, devolucionId)]);
    expect(resultados.filter((r) => r === "ok")).toHaveLength(1);
    expect(resultados.filter((r) => r !== "ok")).toEqual(["0 filas"]);
    expect(await cuantas("Operacion", `"revierteAOperacionId" = '${devolucionId}'`)).toBe(1);
    expect(await cuantas("Operacion", `"id" = '${devolucionId}' AND "anuladaEn" IS NOT NULL AND "motivoAnulacion" = '${MOTIVO}'`)).toBe(1);
    expect(await cuantas("NotaCreditoProveedor", `"anuladaEn" IS NOT NULL`)).toBe(1);
  });

  it("ocho bloques a la vez: una sola gana, las otras siete tocan 0 filas, y queda UNA reversión", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const { notaId, devolucionId } = await notaConDevolucion();
    const todos = await clientes(8);
    const resultados = await Promise.all(todos.map((c) => anular(c, notaId, devolucionId)));
    expect(resultados.filter((r) => r === "ok")).toHaveLength(1);
    expect(resultados.filter((r) => r === "0 filas")).toHaveLength(7);
    expect(await cuantas("Operacion", `"revierteAOperacionId" = '${devolucionId}'`)).toBe(1);
  });

  it("aunque la guarda de la nota faltara, el árbitro de la reversión es la base: dos reversiones de la MISMA devolución a la vez dejan una y la otra recibe 23505 sobre el único de la reversión", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const { devolucionId } = await notaConDevolucion();
    const [a, b] = await clientes(2);
    const revertir = (c: Client) => { const id = randomUUID(); return intentar(c, `INSERT INTO "Operacion" ("id","sucursalId","fecha","usuarioId","proceso","revierteAOperacionId") VALUES ($1,$2,now(),$3,'AJUSTE',$4)`, [id, e.sucursalA, e.usuarioId, devolucionId]); };
    const resultados = await Promise.all([revertir(a!), revertir(b!)]);
    expect(resultados.filter((r) => r === null)).toHaveLength(1);
    expect(resultados.filter((r) => r !== null)).toEqual([{ codigo: "23505", restriccion: UNICO_REVERSION }]);
    expect(await cuantas("Operacion", `"revierteAOperacionId" = '${devolucionId}'`)).toBe(1);
  });
});

describe("EL TOPE (Decisión 5): lo acreditado de un renglón no pasa de su precioTotal porque el caso de uso toma la fila de la factura con FOR UPDATE", () => {
  it("renglón de 200,00 y ocho clientes que cargan 60,00 cada uno CON el protocolo: confirman exactamente TRES, los otros cinco reciben «excede», y lo acreditado es 180,00", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const renglonId = await renglonDe200();
    const todos = await clientes(8);
    const resultados = await Promise.all(todos.map((c) => cargarNotaConTope(c, e, { renglonId, importe: "60.00" })));
    expect(resultados.filter((r) => r === "ok")).toHaveLength(3);
    expect(resultados.filter((r) => r === "excede")).toHaveLength(5);
    expect(await acreditadoEnSql(renglonId)).toBe("180.00");
    expect(await cuantas("NotaCreditoProveedor")).toBe(3);
    expect(await cuantas("NotaCreditoProveedorImputacion")).toBe(3);
  });

  it("el candado es lo que ordena: A toma la factura y lee 120,00; B espera (se mide con `esperarBloqueo`), y cuando A confirma B ve 180,00, no entra y lo acreditado queda en 180,00", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const renglonId = await renglonDe200();
    const [a, b, previo] = await clientes(3);
    expect(await cargarNotaConTope(previo!, e, { renglonId, importe: "60.00" })).toBe("ok");
    expect(await cargarNotaConTope(previo!, e, { renglonId, importe: "60.00" })).toBe("ok");
    const pidDeB = await pidDe(b!);
    await a!.query("BEGIN");
    await bloquearFactura(a!, e.facturaId);
    expect(await acreditadoDelRenglon(a!, renglonId, "60.00")).toEqual({ acreditado: "120.00", excede: false });
    await b!.query("BEGIN");
    const esperando = bloquearFactura(b!, e.facturaId);
    await esperarBloqueo(pidDeB);
    await insertarNotaConUnaLinea(a!, e, { renglonId, importe: "60.00" });
    await a!.query("COMMIT");
    await esperando;
    // B ya tiene el candado: ahora sí ve lo que A acaba de confirmar.
    expect(await acreditadoDelRenglon(b!, renglonId, "60.00")).toEqual({ acreditado: "180.00", excede: true });
    await b!.query("ROLLBACK");
    expect(await acreditadoEnSql(renglonId)).toBe("180.00");
  });

  it("CONTROL NEGATIVO: sin el candado, con las lecturas intercaladas (los dos leen 120,00 antes de escribir), los dos confirman y se acredita 240,00 > 200,00: la base sola NO frena el exceso, el protocolo es necesario", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const renglonId = await renglonDe200();
    const [a, b, previo] = await clientes(3);
    expect(await cargarNotaConTope(previo!, e, { renglonId, importe: "60.00" })).toBe("ok");
    expect(await cargarNotaConTope(previo!, e, { renglonId, importe: "60.00" })).toBe("ok");
    await a!.query("BEGIN");
    await b!.query("BEGIN");
    expect(await acreditadoDelRenglon(a!, renglonId, "60.00"), "A lee 120,00 y le parece bien").toEqual({ acreditado: "120.00", excede: false });
    expect(await acreditadoDelRenglon(b!, renglonId, "60.00"), "B lee 120,00 y le parece bien").toEqual({ acreditado: "120.00", excede: false });
    await insertarNotaConUnaLinea(a!, e, { renglonId, importe: "60.00" });
    await insertarNotaConUnaLinea(b!, e, { renglonId, importe: "60.00" });
    await a!.query("COMMIT");
    await b!.query("COMMIT");
    expect(await acreditadoEnSql(renglonId)).toBe("240.00");
    expect((await acreditadoDelRenglon(previo!, renglonId, "0.01")).excede, "ya pasó del tope y nada en la base lo impidió").toBe(true);
  });
});

describe("C29: anular la factura y cargar una nota se serializan con el MISMO candado", () => {
  it("A anula la factura y B carga una nota: B espera (se mide), y cuando A confirma B ve la factura anulada y no escribe nada", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const [a, b] = await clientes(2);
    const pidDeB = await pidDe(b!);
    await a!.query("BEGIN");
    expect(await anularFacturaEnCurso(a!, e.facturaId, e.usuarioId)).toBe("ok");
    const cargando = cargarNotaConTope(b!, e, { renglonId: e.renglonMercaderiaId, importe: "40.00" });
    await esperarBloqueo(pidDeB);
    await a!.query("COMMIT");
    expect(await cargando).toBe("factura anulada");
    expect(await cuantas("NotaCreditoProveedor")).toBe(0);
    expect(await cuantas("FacturaProveedor", `"id" = '${e.facturaId}' AND "anuladaEn" IS NOT NULL`)).toBe(1);
  });

  it("al revés: B carga una nota y A intenta anular la factura: A espera (se mide), y cuando B confirma A ve una nota vigente y la factura NO se anula", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const [a, b] = await clientes(2);
    const pidDeA = await pidDe(a!);
    await b!.query("BEGIN");
    expect(await bloquearFactura(b!, e.facturaId)).toBeNull();
    await insertarNotaConUnaLinea(b!, e, { renglonId: e.renglonMercaderiaId, importe: "40.00" });
    const anulando = anularFacturaSinNotas(a!, e.facturaId, e.usuarioId);
    await esperarBloqueo(pidDeA);
    await b!.query("COMMIT");
    expect(await anulando).toBe("tiene notas vigentes");
    expect(await cuantas("FacturaProveedor", `"id" = '${e.facturaId}' AND "anuladaEn" IS NULL`)).toBe(1);
    expect(await cuantas("NotaCreditoProveedor")).toBe(1);
  });

  it("una nota anulada deja de contar: con su única nota anulada la factura SÍ se puede anular; y anular dos veces la factura a la vez deja una ganadora", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const [a, b] = await clientes(2);
    const { notaId } = await insertarNotaConUnaLinea(a!, e, { renglonId: e.renglonMercaderiaId, importe: "40.00" });
    expect(await anularFacturaSinNotas(a!, e.facturaId, e.usuarioId)).toBe("tiene notas vigentes");
    await prismaAdmin.$executeRaw`UPDATE "NotaCreditoProveedor" SET "anuladaEn" = now(), "anuladaPorId" = ${e.usuarioId}, "motivoAnulacion" = 'Mal cargada' WHERE id = ${notaId}`;
    const resultados = await Promise.all([anularFacturaSinNotas(a!, e.facturaId, e.usuarioId), anularFacturaSinNotas(b!, e.facturaId, e.usuarioId)]);
    expect(resultados.filter((r) => r === "ok")).toHaveLength(1);
    expect(resultados.filter((r) => r === "ya anulada")).toHaveLength(1);
  });
});

describe("la misma devolución en dos notas a la vez: una gana", () => {
  /** Una nota con una línea de mercadería y su imputación a la A que acredita `operacionId`, en UNA transacción. */
  async function cargarConDevolucion(c: Client, operacionId: string): Promise<"ok" | string> {
    try {
      await c.query("BEGIN");
      const nota = sentenciaDeInsercion("NotaCreditoProveedor", datosDeNota(e, { importeTotal: "50.00" }));
      await c.query(nota.texto, nota.params);
      const linea = sentenciaDeInsercion("NotaCreditoProveedorLinea", datosDeLinea(e, nota.id));
      await c.query(linea.texto, linea.params);
      const imputacion = sentenciaDeInsercion("NotaCreditoProveedorImputacion", datosDeImputacion(e, linea.id, { operacionDevolucionId: operacionId, cantidadStock: "2" }));
      await c.query(imputacion.texto, imputacion.params);
      await c.query("COMMIT");
      return "ok";
    } catch (error) {
      await c.query("ROLLBACK").catch(() => undefined);
      return `${(error as { code?: string }).code}|${(error as { constraint?: string }).constraint}`;
    }
  }

  it("dos y ocho notas a la vez que acreditan la MISMA devolución: una confirma, las otras reciben 23505 sobre el único de la devolución y no dejan ni la nota ni la línea", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    for (const cuantos of [2, 8]) {
      await limpiarBaseDeTest();
      e = await sembrarEscenarioDeNota();
      const { operacionId } = await sembrarDevolucion(e, "A", 2);
      const todos = await clientes(cuantos);
      const resultados = await Promise.all(todos.map((c) => cargarConDevolucion(c, operacionId)));
      expect(resultados.filter((r) => r === "ok"), `${cuantos} clientes`).toHaveLength(1);
      expect(resultados.filter((r) => r === `23505|${UNICO_DEVOLUCION}`), `${cuantos} clientes`).toHaveLength(cuantos - 1);
      expect([await cuantas("NotaCreditoProveedor"), await cuantas("NotaCreditoProveedorLinea"), await cuantas("NotaCreditoProveedorImputacion")], `${cuantos} clientes`).toEqual([1, 1, 1]);
      await cerrarConexiones();
    }
  });

  it("una devolución distinta no se estorba, y la misma devolución en una nota anulada sigue ocupada (se libera revirtiéndola, que es otra Operacion): la segunda nota recibe 23505", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const uno = await sembrarDevolucion(e, "A", 1);
    const dos = await sembrarDevolucion(e, "B", 1);
    const [a, b] = await clientes(2);
    expect(await Promise.all([cargarConDevolucion(a!, uno.operacionId), cargarConDevolucion(b!, dos.operacionId)])).toEqual(["ok", "ok"]);
    await prismaAdmin.$executeRaw`UPDATE "NotaCreditoProveedor" SET "anuladaEn" = now(), "anuladaPorId" = ${e.usuarioId}, "motivoAnulacion" = 'Anulada' WHERE true`;
    expect(await cargarConDevolucion(a!, uno.operacionId)).toBe(`23505|${UNICO_DEVOLUCION}`);
  });
});

describe("atomicidad: la carga de una nota con su devolución es UNA transacción, todo o nada, en seis tablas", () => {
  /** El bloque completo de una nota con devolución: la `Operacion` DEVOLUCION_PROVEEDOR y su línea de Kardex, la nota (155,00), dos líneas (50,00 de mercadería y 100,00 de gasto), tres imputaciones y un tributo (5,00). `tributo` es el importe del último. */
  async function bloqueCompleto(c: Client, p: { clave?: string; numero?: string; tributo?: string }): Promise<"ok" | string> {
    const operacionId = randomUUID();
    const notaId = randomUUID();
    const l1 = randomUUID();
    const l2 = randomUUID();
    const numero = p.numero ?? `0001-${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
    const sentencias = [
      { texto: `INSERT INTO "Operacion" ("id","sucursalId","fecha","usuarioId","proceso","proveedorId") VALUES ($1,$2,now(),$3,'DEVOLUCION_PROVEEDOR',$4)`, params: [operacionId, e.sucursalA, e.usuarioId, e.proveedorId] },
      {
        texto: `INSERT INTO "MovimientoStock" ("id","operacionId","productoId","seccionId","proceso","cantidad","detalle","precioTotal","precioPorUnidadStock","devuelveAMovimientoId") VALUES ($1,$2,$3,$4,'DEVOLUCION_PROVEEDOR',-2,'2 kg',0,0,$5)`,
        params: [randomUUID(), operacionId, e.productoId, e.seccionA, e.movimientoCompraAId],
      },
      sentenciaDeInsercion("NotaCreditoProveedor", datosDeNota(e, { id: notaId, importeTotal: "155.00", nroComprobante: numero, nroComprobanteNormalizado: numero, ...(p.clave ? { claveIdempotencia: p.clave } : {}) })),
      sentenciaDeInsercion("NotaCreditoProveedorLinea", datosDeLinea(e, notaId, { id: l1, importe: "50.00" })),
      sentenciaDeInsercion("NotaCreditoProveedorLinea", datosDeLineaDeGasto(e, notaId, { id: l2, importe: "100.00" })),
      sentenciaDeInsercion("NotaCreditoProveedorImputacion", datosDeImputacion(e, l1, { importe: "30.00", operacionDevolucionId: operacionId, cantidadStock: "2" })),
      sentenciaDeInsercion("NotaCreditoProveedorImputacion", datosDeImputacion(e, l1, { sucursalId: e.sucursalB, importe: "20.00" })),
      sentenciaDeInsercion("NotaCreditoProveedorImputacion", datosDeImputacion(e, l2, { lineaAdmiteDevolucion: false, sucursalId: e.sucursalB, importe: "100.00" })),
      sentenciaDeInsercion("NotaCreditoProveedorTributo", datosDeTributo(notaId, { importe: p.tributo ?? "5.00" })),
    ];
    try {
      await c.query("BEGIN");
      for (const s of sentencias) await c.query(s.texto, s.params);
      await c.query("COMMIT");
      return "ok";
    } catch (error) {
      await c.query("ROLLBACK").catch(() => undefined);
      return `${(error as { code?: string }).code}|${(error as { constraint?: string }).constraint}`;
    }
  }
  const lasSeisTablas = async () => ({
    notas: await cuantas("NotaCreditoProveedor"),
    lineas: await cuantas("NotaCreditoProveedorLinea"),
    imputaciones: await cuantas("NotaCreditoProveedorImputacion"),
    tributos: await cuantas("NotaCreditoProveedorTributo"),
    devoluciones: await cuantas("Operacion", `"proceso" = 'DEVOLUCION_PROVEEDOR'`),
    kardex: await cuantas("MovimientoStock", `"proceso" = 'DEVOLUCION_PROVEEDOR'`),
  });

  it("con la última sentencia inválida (un tributo de 0,00) no queda NADA en las seis tablas; el mismo bloque, ya válido, entra completo", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const app = await conexionComoApp(EMPRESA_DE_PRUEBA_ID, alcance());
    expect(await bloqueCompleto(app, { tributo: "0.00" })).toBe("23514|NotaCreditoProveedorTributo_importe_positivo_chk");
    expect(await lasSeisTablas()).toEqual({ notas: 0, lineas: 0, imputaciones: 0, tributos: 0, devoluciones: 0, kardex: 0 });
    expect(await bloqueCompleto(app, {})).toBe("ok");
    expect(await lasSeisTablas()).toEqual({ notas: 1, lineas: 2, imputaciones: 3, tributos: 1, devoluciones: 1, kardex: 1 });
  });

  it("si falla una imputación del medio (la devolución de una línea de gasto), tampoco queda nada, ni la Operacion ni su línea de Kardex", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const app = await conexionComoApp(EMPRESA_DE_PRUEBA_ID, alcance());
    const notaId = randomUUID();
    const l2 = randomUUID();
    const operacionId = randomUUID();
    const sentencias = [
      { texto: `INSERT INTO "Operacion" ("id","sucursalId","fecha","usuarioId","proceso","proveedorId") VALUES ($1,$2,now(),$3,'DEVOLUCION_PROVEEDOR',$4)`, params: [operacionId, e.sucursalA, e.usuarioId, e.proveedorId] },
      sentenciaDeInsercion("NotaCreditoProveedor", datosDeNota(e, { id: notaId })),
      sentenciaDeInsercion("NotaCreditoProveedorLinea", datosDeLineaDeGasto(e, notaId, { id: l2 })),
      sentenciaDeInsercion("NotaCreditoProveedorImputacion", datosDeImputacion(e, l2, { operacionDevolucionId: operacionId, cantidadStock: "2" })),
    ];
    await app.query("BEGIN");
    let error: { code?: string; constraint?: string } | null = null;
    try {
      for (const s of sentencias) await app.query(s.texto, s.params);
    } catch (e2) {
      error = e2 as { code?: string; constraint?: string };
    }
    await app.query("ROLLBACK");
    expect([error?.code, error?.constraint]).toEqual(["23503", "NotaCreditoProveedorImputacion_linea_fkey"]);
    expect(await lasSeisTablas()).toEqual({ notas: 0, lineas: 0, imputaciones: 0, tributos: 0, devoluciones: 0, kardex: 0 });
  });

  it("dos bloques IGUALES a la vez (misma clave de idempotencia y mismo número): queda UN solo bloque, completo, y el perdedor no deja ni una fila suelta (ni su Operacion ni su línea de Kardex)", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const [a, b] = await clientes(2);
    const clave = randomUUID();
    const resultados = await Promise.all([bloqueCompleto(a!, { clave, numero: NUMERO }), bloqueCompleto(b!, { clave, numero: NUMERO })]);
    expect(resultados.filter((r) => r === "ok")).toHaveLength(1);
    const perdedor = resultados.filter((r) => r !== "ok");
    expect(perdedor).toHaveLength(1);
    expect([`23505|${UNICO_NUMERO}`, `23505|${UNICO_CLAVE}`]).toContain(perdedor[0]);
    expect(await lasSeisTablas()).toEqual({ notas: 1, lineas: 2, imputaciones: 3, tributos: 1, devoluciones: 1, kardex: 1 });
  });
});

describe("los privilegios del candado: motor2_app puede tomar con FOR UPDATE la factura y la nota, pero no el renglón ni las líneas", () => {
  it("`SELECT … FOR UPDATE` sobre FacturaProveedor y sobre NotaCreditoProveedor anda; sobre FacturaProveedorRenglon, las líneas, las imputaciones y los tributos da 42501", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const nota = await prisma.notaCreditoProveedor.create({ data: datosDeNota(e) as never });
    const linea = await prisma.notaCreditoProveedorLinea.create({ data: datosDeLinea(e, nota.id) as never });
    const imputacion = await prisma.notaCreditoProveedorImputacion.create({ data: datosDeImputacion(e, linea.id) as never });
    const tributo = await prisma.notaCreditoProveedorTributo.create({ data: datosDeTributo(nota.id) as never });
    const app = await conexionComoApp(EMPRESA_DE_PRUEBA_ID, alcance());
    const bloquear = (tabla: string, id: string) => intentar(app, `SELECT 1 FROM "${tabla}" WHERE "id" = $1 FOR UPDATE`, [id]);
    expect(await bloquear("FacturaProveedor", e.facturaId)).toBeNull();
    expect(await bloquear("NotaCreditoProveedor", nota.id)).toBeNull();
    expect(await bloquear("FacturaProveedorRenglon", e.renglonMercaderiaId)).toMatchObject({ codigo: "42501" });
    expect(await bloquear("NotaCreditoProveedorLinea", linea.id)).toMatchObject({ codigo: "42501" });
    expect(await bloquear("NotaCreditoProveedorImputacion", imputacion.id)).toMatchObject({ codigo: "42501" });
    expect(await bloquear("NotaCreditoProveedorTributo", tributo.id)).toMatchObject({ codigo: "42501" });
  });
});
