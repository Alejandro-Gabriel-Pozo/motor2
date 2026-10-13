import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { calcularPayloadHash, decidirIdempotencia, MENSAJE_CONFLICTO_IDEMPOTENCIA } from "../../src/core/movimientos/idempotencia";
import { sembrarDistribucion, sembrarEscenarioDeCentros, sentenciaDeInsercion, sentenciasDeDistribucion, type EscenarioDeCentros } from "../setup/centros-de-costos";
import { cerrarConexiones, conexionComoApp, esperarBloqueo, intentar, pidDe } from "../setup/gasto";
import { limpiarBaseDeTest, prismaAdmin } from "../setup/test-db";

/**
 * Paquete 5, M7 — la distribución de un gasto entre centros de costos bajo concurrencia, contra la base real y como `motor2_app` (varios clientes `pg` a la vez, cada uno en su conexión y con el alcance de la sucursal A).
 *
 * Qué se mide: UNA ganadora por (imputación, plan, número) cuando varios distribuyen o corrigen a la vez (la decide el único de la base, no una lectura previa; las demás reciben 23505, la segunda ESPERA a la primera y las líneas del perdedor no
 * existen); la idempotencia (la clave es única GLOBAL: repetida, simultánea o en otra imputación da 23505, y la fila guardada reproduce el mensaje con `decidirIdempotencia`); la atomicidad (cabecera y líneas van en UNA transacción: todo o nada);
 * y el catálogo (dos altas simultáneas del mismo código, del mismo nombre con otras mayúsculas o de la misma aplicabilidad dejan una sola).
 *
 * Mutaciones demostradas (ver las filas O.300 a O.309 de docs/pureza-integracion.md): sacar el único (imputación, plan, numero) y sacar el único de la clave de idempotencia.
 */
afterAll(() => prismaAdmin.$disconnect());

const UNICO_NUMERO = "DistribucionCostoVersion_imputacion_plan_numero_key";
const UNICO_CLAVE = "DistribucionCostoVersion_claveIdempotencia_key";
const hayRol = async (rol: string) => ((await prismaAdmin.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM pg_roles WHERE rolname = ${rol}`)[0]!.n) === BigInt(1);

let e: EscenarioDeCentros;
beforeEach(async () => {
  await limpiarBaseDeTest();
  e = await sembrarEscenarioDeCentros();
});
afterEach(cerrarConexiones);

const cuantas = async (tabla: string, filtro = "TRUE") => Number((await prismaAdmin.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM "${tabla}" WHERE ${filtro}`))[0]!.n);
const clientes = (cuantos: number) => Promise.all(Array.from({ length: cuantos }, () => conexionComoApp(undefined, { lectura: [e.sucursalA], escritura: [e.sucursalA] })));
/** Dos líneas que suman la imputación A: 60 % y 40 % de 120,00 con 20,00 de IVA computable. */
const LINEAS = (): Array<{ centroId: string; porcentajeBp: number; importe: string; importeIvaComputable: string }> => [
  { centroId: e.centroUnAId, porcentajeBp: 6000, importe: "72.00", importeIvaComputable: "12.00" },
  { centroId: e.centroUnBId, porcentajeBp: 4000, importe: "48.00", importeIvaComputable: "8.00" },
];
/** La distribución completa (cabecera y dos líneas) de la imputación A, con su clave y su huella propias; `version` pisa lo de la cabecera. */
const distribucion = (version: Record<string, unknown> = {}, opciones: { imputacionId?: string; planId?: string } = {}) =>
  sentenciasDeDistribucion({ imputacionId: opciones.imputacionId ?? e.imputacionAId, planId: opciones.planId ?? e.planId, usuarioId: e.usuarioId }, version, LINEAS());

/** Corre las sentencias en UNA transacción: «ok» si confirma, o `código|restricción` del error si se deshizo. */
async function bloque(c: Client, sentencias: Array<{ texto: string; params: unknown[] }>) {
  try {
    await c.query("BEGIN");
    for (const s of sentencias) await c.query(s.texto, s.params);
    await c.query("COMMIT");
    return "ok" as const;
  } catch (error) {
    await c.query("ROLLBACK").catch(() => undefined);
    return `${(error as { code?: string }).code}|${(error as { constraint?: string }).constraint}`;
  }
}

describe("una ganadora por (imputación, plan, número): distribuir a la vez no duplica", () => {
  it("dos clientes a la vez con la misma (imputación, plan, número 1) y claves DISTINTAS: exactamente uno confirma, el otro recibe 23505 sobre el único y queda UNA cabecera con sus 2 líneas", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const [a, b] = await clientes(2);
    const resultados = await Promise.all([bloque(a!, distribucion()), bloque(b!, distribucion())]);
    expect(resultados.filter((r) => r === "ok")).toHaveLength(1);
    expect(resultados.filter((r) => r !== "ok")).toEqual([`23505|${UNICO_NUMERO}`]);
    expect(await cuantas("DistribucionCostoVersion")).toBe(1);
    expect(await cuantas("DistribucionCostoLinea"), "las líneas del perdedor no existen").toBe(2);
  });

  it("ocho clientes a la vez: queda una sola cabecera con sus 2 líneas y los otros siete reciben 23505", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const todos = await clientes(8);
    const resultados = await Promise.all(todos.map((c) => bloque(c, distribucion())));
    expect(resultados.filter((r) => r === "ok")).toHaveLength(1);
    expect(resultados.filter((r) => r === `23505|${UNICO_NUMERO}`)).toHaveLength(7);
    expect([await cuantas("DistribucionCostoVersion"), await cuantas("DistribucionCostoLinea")]).toEqual([1, 2]);
  });

  it("el segundo INSERT ESPERA al primero: si éste hace ROLLBACK, entra; si CONFIRMA, recibe 23505", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const [a, b] = await clientes(2);
    const pidDeB = await pidDe(b!);
    // 1) ROLLBACK de la primera: la segunda, que esperaba, entra.
    await a!.query("BEGIN");
    const [primera] = distribucion({ numero: 1 });
    await a!.query(primera!.texto, primera!.params);
    await b!.query("BEGIN");
    const [segunda] = distribucion({ numero: 1 });
    const esperando = b!.query(segunda!.texto, segunda!.params);
    await esperarBloqueo(pidDeB);
    await a!.query("ROLLBACK");
    expect((await esperando).rowCount).toBe(1);
    await b!.query("COMMIT");
    expect(await cuantas("DistribucionCostoVersion")).toBe(1);
    // 2) COMMIT de la primera, sobre el número 2: la segunda, que esperaba, pierde.
    await a!.query("BEGIN");
    const [tercera] = distribucion({ numero: 2, motivo: "Corrección" });
    await a!.query(tercera!.texto, tercera!.params);
    await b!.query("BEGIN");
    const [cuarta] = distribucion({ numero: 2, motivo: "Otra corrección" });
    const perdedora = b!.query(cuarta!.texto, cuarta!.params).then(() => "entró" as const, (error: { code?: string; constraint?: string }) => `${error.code}|${error.constraint}`);
    await esperarBloqueo(pidDeB);
    await a!.query("COMMIT");
    expect(await perdedora).toBe(`23505|${UNICO_NUMERO}`);
    await b!.query("ROLLBACK");
    expect(await cuantas("DistribucionCostoVersion")).toBe(2);
  });

  it("dos correcciones a la vez que calculan las dos `numero = 2` (vigente + 1, leído con la misma vista) dejan UNA sola: gana una y la otra recibe 23505", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    await sembrarDistribucion(e, e.imputacionAId, LINEAS());
    const [a, b] = await clientes(2);
    const siguiente = async (c: Client) => {
      await c.query("BEGIN");
      const r = await c.query<{ n: number }>(`SELECT COALESCE(max("numero"), 0) + 1 AS n FROM "DistribucionCostoVersion" WHERE "imputacionDeGastoId" = $1 AND "planDeCostosId" = $2`, [e.imputacionAId, e.planId]);
      return r.rows[0]!.n;
    };
    const [na, nb] = [await siguiente(a!), await siguiente(b!)];
    expect([na, nb], "las dos leen la misma vigente y calculan el mismo número").toEqual([2, 2]);
    const terminar = async (c: Client, numero: number, motivo: string) => {
      try {
        for (const s of distribucion({ numero, motivo })) await c.query(s.texto, s.params);
        await c.query("COMMIT");
        return "ok" as const;
      } catch (error) {
        await c.query("ROLLBACK").catch(() => undefined);
        return `${(error as { code?: string }).code}|${(error as { constraint?: string }).constraint}`;
      }
    };
    const resultados = await Promise.all([terminar(a!, na, "Primera corrección"), terminar(b!, nb, "Segunda corrección")]);
    expect(resultados.filter((r) => r === "ok")).toHaveLength(1);
    expect(resultados.filter((r) => r !== "ok")).toEqual([`23505|${UNICO_NUMERO}`]);
    expect(await cuantas("DistribucionCostoVersion", `"numero" = 2`)).toBe(1);
    expect(await cuantas("DistribucionCostoLinea")).toBe(4);
  });

  it("planes e imputaciones distintos NO se estorban: entran todos", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const todos = await clientes(4);
    const lineasOtroPlan = [{ centroId: e.centroOtroPlanId, porcentajeBp: 10000, importe: "120.00", importeIvaComputable: "20.00" }];
    const lote = [
      bloque(todos[0]!, distribucion({ numero: 1 })),
      bloque(todos[1]!, distribucion({ numero: 2, motivo: "Corrección" })),
      bloque(todos[2]!, sentenciasDeDistribucion({ imputacionId: e.imputacionAId, planId: e.planOtroId, usuarioId: e.usuarioId }, { numero: 1 }, lineasOtroPlan)),
    ];
    // La imputación de B no la ve este alcance: se prueba aparte con el alcance de B.
    const deB = await conexionComoApp(undefined, { lectura: [e.sucursalB], escritura: [e.sucursalB] });
    lote.push(bloque(deB, sentenciasDeDistribucion({ imputacionId: e.imputacionBId, planId: e.planId, usuarioId: e.usuarioId }, { numero: 1 }, [{ centroId: e.centroUnAId, porcentajeBp: 10000, importe: "80.00" }])));
    expect(await Promise.all(lote)).toEqual(["ok", "ok", "ok", "ok"]);
    expect(await cuantas("DistribucionCostoVersion")).toBe(4);
  });
});

describe("idempotencia: la clave es única GLOBAL y la fila guardada reproduce el resultado", () => {
  it("la misma clave dos veces seguidas: queda UNA fila y el segundo intento da 23505 sobre el único de la clave", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const app = (await clientes(1))[0]!;
    const clave = randomUUID();
    const [primera] = distribucion({ numero: 1, claveIdempotencia: clave });
    expect(await intentar(app, primera!.texto, primera!.params)).toBeNull();
    // Otro número: el que frena es la clave, no el (imputación, plan, número).
    const [repetida] = distribucion({ numero: 2, motivo: "Corrección", claveIdempotencia: clave });
    expect(await intentar(app, repetida!.texto, repetida!.params)).toEqual({ codigo: "23505", restriccion: UNICO_CLAVE });
    expect(await cuantas("DistribucionCostoVersion")).toBe(1);
  });

  it("la misma clave a la vez (2 y 8 clientes): queda UNA fila; el que pierde choca contra uno de los dos únicos", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    for (const cuantos of [2, 8]) {
      await prismaAdmin.$executeRawUnsafe(`DELETE FROM "DistribucionCostoLinea"`);
      await prismaAdmin.$executeRawUnsafe(`DELETE FROM "DistribucionCostoVersion"`);
      const todos = await clientes(cuantos);
      const clave = randomUUID();
      const resultados = await Promise.all(todos.map((c) => bloque(c, distribucion({ numero: 1, claveIdempotencia: clave }))));
      expect(resultados.filter((r) => r === "ok"), `${cuantos} clientes`).toHaveLength(1);
      const perdedoras = resultados.filter((r) => r !== "ok");
      expect(perdedoras, `${cuantos} clientes`).toHaveLength(cuantos - 1);
      for (const p of perdedoras) expect([`23505|${UNICO_NUMERO}`, `23505|${UNICO_CLAVE}`]).toContain(p);
      expect([await cuantas("DistribucionCostoVersion"), await cuantas("DistribucionCostoLinea")], `${cuantos} clientes`).toEqual([1, 2]);
    }
  });

  it("la misma clave en OTRA imputación da 23505: la clave es global, no por imputación", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const app = (await clientes(1))[0]!;
    const deB = await conexionComoApp(undefined, { lectura: [e.sucursalA, e.sucursalB], escritura: [e.sucursalA, e.sucursalB] });
    const clave = randomUUID();
    const [primera] = distribucion({ claveIdempotencia: clave });
    expect(await intentar(app, primera!.texto, primera!.params)).toBeNull();
    const [enOtra] = distribucion({ claveIdempotencia: clave }, { imputacionId: e.imputacionBId });
    expect(await intentar(deB, enOtra!.texto, enOtra!.params)).toEqual({ codigo: "23505", restriccion: UNICO_CLAVE });
    expect(await cuantas("DistribucionCostoVersion")).toBe(1);
  });

  it("al repetir, la fila guardada alcanza para `decidirIdempotencia`: misma huella, `duplicado` con el mensaje original; otra huella, `conflicto`; sin fila, `nueva`", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const app = (await clientes(1))[0]!;
    const clave = randomUUID();
    const pedido = { imputacionId: e.imputacionAId, planId: e.planId, lineas: [{ centroId: e.centroUnAId, porcentajeBp: 6000 }, { centroId: e.centroUnBId, porcentajeBp: 4000 }] };
    const huella = calcularPayloadHash("distribuir-gasto", e.sucursalA, pedido);
    const mensaje = "Gasto distribuido entre 2 unidades de negocio.";
    expect(await bloque(app, distribucion({ claveIdempotencia: clave, payloadHash: huella, resultadoMensaje: mensaje }))).toBe("ok");

    const leer = async (c: string) => (await app.query<{ payloadHash: string; resultadoMensaje: string }>(`SELECT "payloadHash", "resultadoMensaje" FROM "DistribucionCostoVersion" WHERE "claveIdempotencia" = $1`, [c])).rows[0] ?? null;
    expect(decidirIdempotencia(await leer(clave), huella)).toEqual({ estado: "duplicado", mensaje });
    const otraHuella = calcularPayloadHash("distribuir-gasto", e.sucursalA, { ...pedido, lineas: [{ centroId: e.centroUnAId, porcentajeBp: 5000 }, { centroId: e.centroUnBId, porcentajeBp: 5000 }] });
    expect(decidirIdempotencia(await leer(clave), otraHuella)).toEqual({ estado: "conflicto" });
    expect(MENSAJE_CONFLICTO_IDEMPOTENCIA).toMatch(/datos distintos/);
    expect(decidirIdempotencia(await leer(randomUUID()), huella)).toEqual({ estado: "nueva" });
  });
});

describe("atomicidad: la cabecera y sus líneas van en UNA transacción, todo o nada", () => {
  it("una cabecera con una línea válida y otra con `porcentajeBp = 0` no deja NADA, ni la cabecera ni la línea válida; el mismo bloque ya válido entra completo", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const app = (await clientes(1))[0]!;
    const base = { imputacionId: e.imputacionAId, planId: e.planId, usuarioId: e.usuarioId };
    const mala = sentenciasDeDistribucion(base, {}, [
      { centroId: e.centroUnAId, porcentajeBp: 10000, importe: "120.00", importeIvaComputable: "20.00" },
      { centroId: e.centroUnBId, porcentajeBp: 0, importe: "0.00" },
    ]);
    expect(await bloque(app, mala)).toBe("23514|DistribucionCostoLinea_porcentaje_chk");
    expect([await cuantas("DistribucionCostoVersion"), await cuantas("DistribucionCostoLinea")]).toEqual([0, 0]);
    expect(await bloque(app, distribucion())).toBe("ok");
    expect([await cuantas("DistribucionCostoVersion"), await cuantas("DistribucionCostoLinea")]).toEqual([1, 2]);
  });

  it("una línea con un centro de OTRO plan (23503) deshace el bloque entero", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const app = (await clientes(1))[0]!;
    const mala = sentenciasDeDistribucion({ imputacionId: e.imputacionAId, planId: e.planId, usuarioId: e.usuarioId }, {}, [
      { centroId: e.centroUnAId, porcentajeBp: 5000, importe: "60.00", importeIvaComputable: "10.00" },
      { centroId: e.centroOtroPlanId, porcentajeBp: 5000, importe: "60.00", importeIvaComputable: "10.00" },
    ]);
    expect(await bloque(app, mala)).toBe("23503|DistribucionCostoLinea_empresaId_planDeCostosId_centroDeCo_fkey");
    expect([await cuantas("DistribucionCostoVersion"), await cuantas("DistribucionCostoLinea")]).toEqual([0, 0]);
  });

  it("un bloque con las distribuciones de DOS imputaciones (A y B) y la segunda inválida no deja ninguna de las dos", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const ambas = await conexionComoApp(undefined, { lectura: [e.sucursalA, e.sucursalB], escritura: [e.sucursalA, e.sucursalB] });
    const deA = distribucion();
    const deBMala = sentenciasDeDistribucion({ imputacionId: e.imputacionBId, planId: e.planId, usuarioId: e.usuarioId }, { motivo: "x".repeat(201) }, [{ centroId: e.centroUnAId, porcentajeBp: 10000, importe: "80.00" }]);
    expect(await bloque(ambas, [...deA, ...deBMala])).toBe("23514|DistribucionCostoVersion_motivo_chk");
    expect([await cuantas("DistribucionCostoVersion"), await cuantas("DistribucionCostoLinea")]).toEqual([0, 0]);
  });
});

describe("el catálogo: dos altas simultáneas dejan una sola (la decide la base)", () => {
  /** Lanza `cuantos` altas a la vez y devuelve los resultados. */
  const enParalelo = async (cuantos: number, sentencia: (i: number) => { texto: string; params: unknown[] }) => {
    const todos = await clientes(cuantos);
    return Promise.all(todos.map((c, i) => { const s = sentencia(i); return intentar(c, s.texto, s.params); }));
  };

  it("el mismo código de plan (2 y 8 clientes): uno entra, los demás reciben 23505", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    for (const cuantos of [2, 8]) {
      const resultados = await enParalelo(cuantos, (i) => sentenciaDeInsercion("PlanDeCostos", { id: randomUUID(), codigo: `NUEVO_${cuantos}`, nombre: `Plan ${cuantos}.${i}` }));
      expect(resultados.filter((r) => r === null), `${cuantos} clientes`).toHaveLength(1);
      expect(resultados.filter((r) => r?.codigo === "23505" && r.restriccion === "PlanDeCostos_empresaId_codigo_key"), `${cuantos} clientes`).toHaveLength(cuantos - 1);
      expect(await cuantas("PlanDeCostos", `"codigo" = 'NUEVO_${cuantos}'`)).toBe(1);
    }
  });

  it("el mismo nombre de plan con otras mayúsculas: uno entra y el otro recibe 23505 sobre el único de lower(nombre)", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const nombres = ["Mi Plan", "MI PLAN", "mi plan", "mI pLaN"];
    const resultados = await enParalelo(nombres.length, (i) => sentenciaDeInsercion("PlanDeCostos", { id: randomUUID(), codigo: `MAYUS_${i}`, nombre: nombres[i]! }));
    expect(resultados.filter((r) => r === null)).toHaveLength(1);
    expect(resultados.filter((r) => r?.codigo === "23505" && r.restriccion === "PlanDeCostos_nombre_lower_key")).toHaveLength(nombres.length - 1);
    expect(await cuantas("PlanDeCostos", `lower("nombre") = 'mi plan'`)).toBe(1);
  });

  it("el mismo nombre de centro del mismo plan con otras mayúsculas, y el mismo código de centro: una sola alta", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const porNombre = await enParalelo(3, (i) => sentenciaDeInsercion("CentroDeCostos", { id: randomUUID(), planDeCostosId: e.planId, codigo: `NOM_${i}`, nombre: ["Cocina", "COCINA", "cocina"][i]! }));
    expect(porNombre.filter((r) => r === null)).toHaveLength(1);
    expect(porNombre.filter((r) => r?.restriccion === "CentroDeCostos_nombre_lower_key")).toHaveLength(2);
    const porCodigo = await enParalelo(3, (i) => sentenciaDeInsercion("CentroDeCostos", { id: randomUUID(), planDeCostosId: e.planId, codigo: "MISMO", nombre: `Centro ${i}` }));
    expect(porCodigo.filter((r) => r === null)).toHaveLength(1);
    expect(porCodigo.filter((r) => r?.restriccion === "CentroDeCostos_empresaId_codigo_key")).toHaveLength(2);
    expect(await cuantas("CentroDeCostos", `"codigo" = 'MISMO'`)).toBe(1);
  });

  it("la misma aplicabilidad (plan, sucursal) a la vez: una sola fila", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    await prismaAdmin.planDeCostosSucursal.deleteMany({ where: { planDeCostosId: e.planId, sucursalId: e.sucursalA } });
    const resultados = await enParalelo(4, (i) => sentenciaDeInsercion("PlanDeCostosSucursal", { id: randomUUID(), planDeCostosId: e.planId, sucursalId: e.sucursalA, aplica: i % 2 === 0 }));
    expect(resultados.filter((r) => r === null)).toHaveLength(1);
    expect(resultados.filter((r) => r?.codigo === "23505" && r.restriccion === "PlanDeCostosSucursal_planDeCostosId_sucursalId_key")).toHaveLength(3);
    expect(await cuantas("PlanDeCostosSucursal", `"planDeCostosId" = '${e.planId}' AND "sucursalId" = '${e.sucursalA}'`)).toBe(1);
  });
});
