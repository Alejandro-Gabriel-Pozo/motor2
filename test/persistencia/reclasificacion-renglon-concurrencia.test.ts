import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { calcularPayloadHash, decidirIdempotencia, MENSAJE_CONFLICTO_IDEMPOTENCIA } from "../../src/core/movimientos/idempotencia";
import { cerrarConexiones, conexionComoApp, datosDeRenglonSinStock, esperarBloqueo, intentar, pidDe, sembrarEscenarioDeGasto, sentenciaDeReclasificacion, type EscenarioDeGasto } from "../setup/gasto";
import { limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";

/**
 * Paquete 4, M5 — la reclasificación de un renglón bajo concurrencia, contra la base real y como `motor2_app` (varios clientes `pg` a la vez, cada uno en su conexión).
 *
 * Qué se mide: UNA ganadora por (renglón, número) cuando varios reclasifican a la vez (la decide el único de la base, no una lectura previa; las demás reciben 23505 y la segunda ESPERA a la primera); la idempotencia (la clave es única GLOBAL: repetida,
 * simultánea o en otro renglón da 23505, y la fila guardada reproduce el mensaje con `decidirIdempotencia`); y la atomicidad de reclasificar «por bloque» (varias filas en una transacción: todo o nada, sin una tabla de lote).
 *
 * Mutaciones demostradas (ver las filas O.282 a O.285 de docs/pureza-integracion.md): sacar el único (renglón, número) y sacar el único de la clave de idempotencia.
 */
afterAll(() => prismaAdmin.$disconnect());

const UNICO_NUMERO = "ReclasificacionRenglon_facturaProveedorRenglonId_numero_key";
const UNICO_CLAVE = "ReclasificacionRenglon_claveIdempotencia_key";
const hayRol = async (rol: string) => ((await prismaAdmin.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM pg_roles WHERE rolname = ${rol}`)[0]!.n) === BigInt(1);

let e: EscenarioDeGasto;
let otroRenglonId: string;
beforeEach(async () => {
  await limpiarBaseDeTest();
  e = await sembrarEscenarioDeGasto();
  otroRenglonId = (await prisma.facturaProveedorRenglon.create({ data: datosDeRenglonSinStock({ facturaProveedorId: e.facturaId, conceptoGastoId: e.conceptoId }, { orden: 3 }) as never })).id;
});
afterEach(cerrarConexiones);

const cuantas = async (filtro = "TRUE") => Number((await prismaAdmin.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM "ReclasificacionRenglon" WHERE ${filtro}`))[0]!.n);
const clientes = (cuantos: number) => Promise.all(Array.from({ length: cuantos }, () => conexionComoApp()));
/** Una reclasificación del renglón con sus claves de idempotencia y de huella propias (cada cliente tiene la suya). */
const sentencia = (extra: Record<string, unknown> = {}) => sentenciaDeReclasificacion(e, extra);

describe("una ganadora por (renglón, número): reclasificar a la vez no duplica", () => {
  it("dos clientes a la vez con el mismo (renglón, número 1) y claves DISTINTAS: exactamente uno confirma y el otro recibe 23505 sobre el único (renglón, número)", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const [a, b] = await clientes(2);
    const s1 = sentencia({ tipoDeCosto: "INVERSION" });
    const s2 = sentencia({ tipoDeCosto: "EXTRAORDINARIO" });
    const resultados = await Promise.all([intentar(a!, s1.texto, s1.params), intentar(b!, s2.texto, s2.params)]);
    expect(resultados.filter((r) => r === null)).toHaveLength(1);
    expect(resultados.filter((r) => r !== null)).toEqual([{ codigo: "23505", restriccion: UNICO_NUMERO }]);
    expect(await cuantas()).toBe(1);
  });

  it("ocho clientes a la vez: una sola reclasificación queda guardada y las otras siete reciben 23505", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const todos = await clientes(8);
    const resultados = await Promise.all(todos.map((c) => { const s = sentencia(); return intentar(c, s.texto, s.params); }));
    expect(resultados.filter((r) => r === null)).toHaveLength(1);
    expect(resultados.filter((r) => r?.codigo === "23505" && r.restriccion === UNICO_NUMERO)).toHaveLength(7);
    expect(await cuantas()).toBe(1);
  });

  it("el segundo INSERT ESPERA al primero: si éste hace ROLLBACK, entra; si CONFIRMA, recibe 23505", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const [a, b] = await clientes(2);
    const pidDeB = await pidDe(b!);
    // 1) ROLLBACK de la primera: la segunda, que esperaba, entra.
    await a!.query("BEGIN");
    const primera = sentencia({ numero: 1 });
    await a!.query(primera.texto, primera.params);
    await b!.query("BEGIN");
    const segunda = sentencia({ numero: 1 });
    const esperando = b!.query(segunda.texto, segunda.params);
    await esperarBloqueo(pidDeB);
    await a!.query("ROLLBACK");
    expect((await esperando).rowCount).toBe(1);
    await b!.query("COMMIT");
    expect(await cuantas()).toBe(1);
    // 2) COMMIT de la primera, sobre el número 2: la segunda, que esperaba, pierde.
    await a!.query("BEGIN");
    const tercera = sentencia({ numero: 2 });
    await a!.query(tercera.texto, tercera.params);
    await b!.query("BEGIN");
    const cuarta = sentencia({ numero: 2 });
    const perdedora = b!.query(cuarta.texto, cuarta.params).then(() => "entró" as const, (error: { code?: string; constraint?: string }) => `${error.code}|${error.constraint}`);
    await esperarBloqueo(pidDeB);
    await a!.query("COMMIT");
    expect(await perdedora).toBe(`23505|${UNICO_NUMERO}`);
    await b!.query("ROLLBACK");
    expect(await cuantas()).toBe(2);
  });

  it("renglones distintos y números distintos del mismo renglón NO se estorban: entran todos", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const todos = await clientes(4);
    const sentencias = [
      sentencia({ numero: 1 }), sentencia({ numero: 2 }),
      sentencia({ numero: 1, facturaProveedorRenglonId: otroRenglonId }), sentencia({ numero: 2, facturaProveedorRenglonId: otroRenglonId }),
    ];
    const resultados = await Promise.all(sentencias.map((s, i) => intentar(todos[i]!, s.texto, s.params)));
    expect(resultados).toEqual([null, null, null, null]);
    expect(await cuantas()).toBe(4);
  });
});

describe("idempotencia: la clave es única GLOBAL y la fila guardada reproduce el resultado", () => {
  it("la misma clave dos veces seguidas: queda UNA fila y el segundo intento da 23505 sobre el único de la clave", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const app = await conexionComoApp();
    const clave = randomUUID();
    const primera = sentencia({ numero: 1, claveIdempotencia: clave });
    expect(await intentar(app, primera.texto, primera.params)).toBeNull();
    // Otro número: el que frena es la clave, no el (renglón, número).
    const repetida = sentencia({ numero: 2, claveIdempotencia: clave });
    expect(await intentar(app, repetida.texto, repetida.params)).toEqual({ codigo: "23505", restriccion: UNICO_CLAVE });
    expect(await cuantas()).toBe(1);
  });

  it("la misma clave a la vez (2 y 8 clientes): queda UNA fila; el que pierde choca contra uno de los dos únicos", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    for (const cuantos of [2, 8]) {
      await prismaAdmin.$executeRawUnsafe(`DELETE FROM "ReclasificacionRenglon"`);
      const todos = await clientes(cuantos);
      const clave = randomUUID();
      const resultados = await Promise.all(todos.map((c) => { const s = sentencia({ numero: 1, claveIdempotencia: clave }); return intentar(c, s.texto, s.params); }));
      expect(resultados.filter((r) => r === null), `${cuantos} clientes`).toHaveLength(1);
      const perdedoras = resultados.filter((r) => r !== null);
      expect(perdedoras, `${cuantos} clientes`).toHaveLength(cuantos - 1);
      for (const p of perdedoras) {
        expect(p!.codigo).toBe("23505");
        expect([UNICO_NUMERO, UNICO_CLAVE]).toContain(p!.restriccion);
      }
      expect(await cuantas(), `${cuantos} clientes`).toBe(1);
    }
  });

  it("la misma clave en OTRO renglón da 23505: la clave es global, no por renglón", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const app = await conexionComoApp();
    const clave = randomUUID();
    const primera = sentencia({ claveIdempotencia: clave });
    expect(await intentar(app, primera.texto, primera.params)).toBeNull();
    const enOtro = sentencia({ claveIdempotencia: clave, facturaProveedorRenglonId: otroRenglonId });
    expect(await intentar(app, enOtro.texto, enOtro.params)).toEqual({ codigo: "23505", restriccion: UNICO_CLAVE });
    expect(await cuantas()).toBe(1);
  });

  it("al repetir, la fila guardada alcanza para `decidirIdempotencia`: misma huella, `duplicado` con el mensaje original; otra huella, `conflicto`; sin fila, `nueva`", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const app = await conexionComoApp();
    const clave = randomUUID();
    const huella = calcularPayloadHash("reclasificar-renglon", e.sucursalA, { renglonId: e.renglonId, conceptoGastoId: e.conceptoId, tipoDeCosto: "INVERSION", motivo: "Es una obra" });
    const mensaje = "Renglón reclasificado como inversión.";
    const s = sentencia({ claveIdempotencia: clave, payloadHash: huella, resultadoMensaje: mensaje, tipoDeCosto: "INVERSION" });
    expect(await intentar(app, s.texto, s.params)).toBeNull();

    const leer = async (c: string) => (await app.query<{ payloadHash: string; resultadoMensaje: string }>(`SELECT "payloadHash", "resultadoMensaje" FROM "ReclasificacionRenglon" WHERE "claveIdempotencia" = $1`, [c])).rows[0] ?? null;
    expect(decidirIdempotencia(await leer(clave), huella)).toEqual({ estado: "duplicado", mensaje });
    const otraHuella = calcularPayloadHash("reclasificar-renglon", e.sucursalA, { renglonId: e.renglonId, conceptoGastoId: e.conceptoId, tipoDeCosto: "GASTO_OPERATIVO", motivo: "Es una obra" });
    expect(decidirIdempotencia(await leer(clave), otraHuella)).toEqual({ estado: "conflicto" });
    expect(MENSAJE_CONFLICTO_IDEMPOTENCIA).toMatch(/datos distintos/);
    expect(decidirIdempotencia(await leer(randomUUID()), huella)).toEqual({ estado: "nueva" });
  });
});

describe("atomicidad: reclasificar «por bloque» son varias filas en UNA transacción, todo o nada", () => {
  /** Corre las sentencias en una transacción: «ok» si confirma, o `código|restricción` del error si se deshizo. */
  const bloque = async (c: Awaited<ReturnType<typeof conexionComoApp>>, sentencias: Array<{ texto: string; params: unknown[] }>) => {
    try {
      await c.query("BEGIN");
      for (const s of sentencias) await c.query(s.texto, s.params);
      await c.query("COMMIT");
      return "ok" as const;
    } catch (error) {
      await c.query("ROLLBACK").catch(() => undefined);
      return `${(error as { code?: string }).code}|${(error as { constraint?: string }).constraint}`;
    }
  };

  it("un bloque de dos reclasificaciones (dos renglones) con la segunda inválida no deja NINGUNA, ni la primera", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const app = await conexionComoApp();
    const valida = sentencia({ numero: 1 });
    const invalida = sentencia({ numero: 1, facturaProveedorRenglonId: otroRenglonId, motivo: "   " });
    expect(await bloque(app, [valida, invalida])).toBe("23514|ReclasificacionRenglon_motivo_chk");
    expect(await cuantas()).toBe(0);
    // El mismo bloque, ya válido, entra completo.
    expect(await bloque(app, [valida, sentencia({ numero: 1, facturaProveedorRenglonId: otroRenglonId })])).toBe("ok");
    expect(await cuantas()).toBe(2);
  });

  it("un bloque con un renglón de MERCADERIA entre medio se deshace entero (23503 sobre el discriminador)", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const app = await conexionComoApp();
    const resultado = await bloque(app, [sentencia({ numero: 1 }), sentencia({ numero: 1, facturaProveedorRenglonId: e.renglonMercaderiaId })]);
    expect(resultado).toBe("23503|ReclasificacionRenglon_empresaId_facturaProveedorRenglonId_fkey");
    expect(await cuantas()).toBe(0);
  });

  it("dos bloques IGUALES a la vez (los mismos dos renglones, el mismo número): queda UN solo bloque, completo, y el perdedor no deja ni una fila suelta", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const [a, b] = await clientes(2);
    const armar = () => [sentencia({ numero: 1 }), sentencia({ numero: 1, facturaProveedorRenglonId: otroRenglonId })];
    const resultados = await Promise.all([bloque(a!, armar()), bloque(b!, armar())]);
    expect(resultados.filter((r) => r === "ok")).toHaveLength(1);
    expect(resultados.filter((r) => r !== "ok")).toEqual([`23505|${UNICO_NUMERO}`]);
    expect(await cuantas()).toBe(2);
    expect(await cuantas(`"numero" = 1`)).toBe(2);
    expect(Number((await prismaAdmin.$queryRaw<Array<{ n: bigint }>>`SELECT count(DISTINCT "facturaProveedorRenglonId") AS n FROM "ReclasificacionRenglon"`)[0]!.n)).toBe(2);
  });
});
