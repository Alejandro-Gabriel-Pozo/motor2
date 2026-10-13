import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { claveDeLineaDeVentaConOpciones } from "../../src/core/pos/clave-de-linea-con-opciones";
import { cerrarConexiones, conexionComoApp, esperarBloqueo, intentar, pidDe, type ErrorDePostgres } from "../setup/gasto";
import {
  HUELLA_DE_PRUEBA,
  sembrarEscenarioDeOpciones,
  sentenciaDeApagado,
  sentenciaDeFoto,
  sentenciaDeLinea,
  sentenciaDePrecioLocal,
  sentenciaDeVersionDeOpcion,
  type EscenarioDeOpciones,
} from "../setup/opciones";
import { limpiarBaseDeTest, prismaAdmin } from "../setup/test-db";

/**
 * GO-1 — las opciones de venta bajo concurrencia, idempotencia y atomicidad, contra la base real y como `motor2_app` (varios clientes `pg` a la vez, cada uno en su conexión).
 *
 * Qué se mide: el control optimista de la edición (dos ediciones con `WHERE version = 1`: una toca una fila y la otra cero, sin «gana el último»; con SERIALIZABLE la perdedora recibe 40001); UNA ganadora por (opción, número) cuando
 * dos o más cargan la misma versión a la vez (la decide el único de la base; la segunda ESPERA a la primera); UNA fila cuando dos o más dan de alta la misma grilla o el mismo apagado; que dos mozos con claves distintas que agregan la
 * MISMA configuración dejan las dos líneas (y que `claveDeLineaDeVentaConOpciones` las agrupa en una sola clave); la idempotencia del bloque «comprobante + línea padre + foto + adicional + foto» (la misma clave, seguida o a la vez: un solo bloque
 * completo, el otro recibe 23505 y no deja nada); y la atomicidad (I12): un adicional inválido al final del bloque, o una operación hija inválida al cierre, no dejan NADA.
 *
 * Se corre 3 veces seguidas. Mutaciones demostradas (ver las filas O.320 a O.328 de docs/pureza-integracion.md): sacar el único (opción, número) de las versiones.
 */
afterAll(() => prismaAdmin.$disconnect());

const UNICO_NUMERO = "VersionDeOpcion_opcionId_numero_key";
const UNICO_CLAVE = "AgregadoDeCuenta_claveIdempotencia_key";
const UNICO_PRECIO = "PrecioLocalDeOpcion_sucursalId_productoId_opcionId_key";
const UNICO_APAGADO = "OpcionApagadaEnSucursal_sucursalId_opcionId_key";

let e: EscenarioDeOpciones;
beforeEach(async () => {
  await limpiarBaseDeTest();
  e = await sembrarEscenarioDeOpciones();
});
afterEach(cerrarConexiones);

const cuantos = async (tabla: string, filtro = "TRUE") => Number((await prismaAdmin.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM "${tabla}" WHERE ${filtro}`))[0]!.n);
const alcanceA = () => ({ lectura: [e.sucursalA], escritura: [e.sucursalA] });
const clientes = (n: number) => Promise.all(Array.from({ length: n }, () => conexionComoApp(undefined, alcanceA())));
const probar = (c: Client, s: { texto: string; params: unknown[] }) => intentar(c, s.texto, s.params);

/** Corre varias sentencias en UNA transacción: `null` si confirmó, o el SQLSTATE y la restricción con que se deshizo todo. */
async function bloque(c: Client, sentencias: ReadonlyArray<{ texto: string; params: unknown[] }>): Promise<ErrorDePostgres | null> {
  try {
    await c.query("BEGIN");
    for (const s of sentencias) await c.query(s.texto, s.params);
    await c.query("COMMIT");
    return null;
  } catch (error) {
    await c.query("ROLLBACK").catch(() => undefined);
    const pg = error as { code?: string; constraint?: string };
    return { codigo: pg.code ?? "otro", restriccion: pg.constraint ?? "" };
  }
}

/**
 * El bloque de «agregar un café con opciones y un adicional a una cuenta»: el comprobante de idempotencia (`AgregadoDeCuenta`), la línea padre con su huella, la foto de la variante, el adicional y la foto del adicional. `precioDelAdicional`
 * en 0 lo vuelve inválido (CHECK `CuentaItem_adicional_chk`) justo en la cuarta sentencia, con la mitad del bloque ya escrita.
 */
function bloqueDeAgregar(clave: string, extra: { precioDelAdicional?: string; cuentaId?: string } = {}) {
  const cuentaId = extra.cuentaId ?? e.cuentaAId;
  const padre = sentenciaDeLinea({ cuentaId, productoId: e.cafeId }, { huellaOpciones: HUELLA_DE_PRUEBA });
  const hija = sentenciaDeLinea({ cuentaId, productoId: e.anclaDelShotId }, { precioUnitario: extra.precioDelAdicional ?? "200.00", lineaPadreId: padre.id });
  return [
    {
      texto: `INSERT INTO "AgregadoDeCuenta" ("id", "cuentaId", "claveIdempotencia", "payloadHash", "resultadoMensaje", "creadoPorId") VALUES ($1, $2, $3, 'huella-de-prueba', 'Agregado.', $4)`,
      params: [randomUUID(), cuentaId, clave, e.usuarioId],
    },
    padre,
    sentenciaDeFoto({ ...e, cuentaItemId: padre.id }),
    hija,
    sentenciaDeFoto(
      { ...e, cuentaItemId: hija.id },
      { grupoId: e.grupoAdicionalId, opcionId: e.shotId, versionDeOpcionId: e.versionDe[e.shotId]!, tipoGrupo: "ADICIONAL", nombreGrupo: "Extras", nombreOpcion: "Shot extra", tipoDeDiferencia: "MONTO", importeUnitario: "200.00" },
    ),
  ];
}

/** Borra, como dueño, lo que dejaron los bloques de una vuelta anterior (fotos, adicionales, líneas y comprobantes). */
async function limpiarBloques() {
  await prismaAdmin.opcionElegidaEnLinea.deleteMany();
  await prismaAdmin.cuentaItem.deleteMany({ where: { lineaPadreId: { not: null } } });
  await prismaAdmin.cuentaItem.deleteMany();
  await prismaAdmin.agregadoDeCuenta.deleteMany();
}

const estado = async () => ({
  comprobantes: await cuantos("AgregadoDeCuenta"),
  lineas: await cuantos("CuentaItem"),
  fotos: await cuantos("OpcionElegidaEnLinea"),
});

describe("control optimista: dos ediciones con `WHERE version = 1`, una sola gana", () => {
  const editar = (nombre: string) => ({
    texto: `UPDATE "GrupoDeOpciones" SET "nombre" = $2, "version" = "version" + 1, "actualizadoEn" = now() WHERE "id" = $1 AND "version" = 1`,
    params: [e.grupoVarianteId, nombre],
  });

  it("dos ediciones a la vez: una toca UNA fila y la otra CERO (la segunda ESPERA a la primera y después ya no ve la versión 1); no hay «gana el último»", async () => {
    const [a, b] = await clientes(2);
    const pidDeB = await pidDe(b!);
    await a!.query("BEGIN");
    const primera = editar("Leche A");
    expect((await a!.query(primera.texto, primera.params)).rowCount).toBe(1);
    await b!.query("BEGIN");
    const segunda = editar("Leche B");
    const esperando = b!.query(segunda.texto, segunda.params);
    await esperarBloqueo(pidDeB);
    await a!.query("COMMIT");
    expect((await esperando).rowCount, "la segunda ya no encuentra la versión 1").toBe(0);
    await b!.query("COMMIT");
    const g = await prismaAdmin.grupoDeOpciones.findUniqueOrThrow({ where: { id: e.grupoVarianteId } });
    expect([g.nombre, g.version]).toEqual(["Leche A", 2]);
  });

  it("ocho ediciones a la vez: exactamente una toca la fila; la versión queda en 2 y el nombre es el de la ganadora", async () => {
    const todos = await clientes(8);
    const resultados = await Promise.all(todos.map((c, i) => { const s = editar(`Leche ${i}`); return c.query(s.texto, s.params).then((r) => ({ i, filas: r.rowCount })); }));
    const ganadoras = resultados.filter((r) => r.filas === 1);
    expect(ganadoras).toHaveLength(1);
    expect(resultados.filter((r) => r.filas === 0)).toHaveLength(7);
    const g = await prismaAdmin.grupoDeOpciones.findUniqueOrThrow({ where: { id: e.grupoVarianteId } });
    expect([g.nombre, g.version]).toEqual([`Leche ${ganadoras[0]!.i}`, 2]);
  });

  it("con SERIALIZABLE, la que leyó la versión 1 y pierde recibe 40001 (no se pisa en silencio)", async () => {
    const [a, b] = await clientes(2);
    const pidDeB = await pidDe(b!);
    for (const c of [a!, b!]) {
      await c.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      expect((await c.query<{ version: number }>(`SELECT "version" FROM "GrupoDeOpciones" WHERE "id" = $1`, [e.grupoVarianteId])).rows[0]!.version).toBe(1);
    }
    const primera = editar("Leche A");
    expect((await a!.query(primera.texto, primera.params)).rowCount).toBe(1);
    const segunda = editar("Leche B");
    const perdedora = b!.query(segunda.texto, segunda.params).then(() => "entró" as const, (error: { code?: string }) => error.code ?? "otro");
    await esperarBloqueo(pidDeB);
    await a!.query("COMMIT");
    expect(await perdedora).toBe("40001");
    await b!.query("ROLLBACK");
    expect((await prismaAdmin.grupoDeOpciones.findUniqueOrThrow({ where: { id: e.grupoVarianteId } })).nombre).toBe("Leche A");
  });
});

describe("dos versiones de la misma opción a la vez: una ganadora por (opción, número)", () => {
  const version = (extra: Record<string, unknown> = {}) => sentenciaDeVersionDeOpcion({ opcionId: e.chicoId, usuarioId: e.usuarioId }, { numero: 2, ...extra });

  it("dos y ocho clientes con el mismo número: exactamente uno confirma y los demás reciben 23505 sobre el único (opción, número)", async () => {
    for (const n of [2, 8]) {
      await prismaAdmin.versionDeOpcion.deleteMany({ where: { opcionId: e.chicoId, numero: { gt: 1 } } });
      const todos = await clientes(n);
      const resultados = await Promise.all(todos.map((c, i) => probar(c, version({ diferenciaPrecio: `-${i + 1}0.00` }))));
      expect(resultados.filter((r) => r === null), `${n} clientes`).toHaveLength(1);
      expect(resultados.filter((r) => r?.codigo === "23505" && r.restriccion === UNICO_NUMERO), `${n} clientes`).toHaveLength(n - 1);
      expect(await cuantos("VersionDeOpcion", `"opcionId" = '${e.chicoId}' AND "numero" = 2`), `${n} clientes`).toBe(1);
    }
  });

  it("el segundo INSERT ESPERA al primero: si éste hace ROLLBACK, entra; si CONFIRMA, recibe 23505", async () => {
    const [a, b] = await clientes(2);
    const pidDeB = await pidDe(b!);
    await a!.query("BEGIN");
    const primera = version();
    await a!.query(primera.texto, primera.params);
    await b!.query("BEGIN");
    const segunda = version();
    const esperando = b!.query(segunda.texto, segunda.params);
    await esperarBloqueo(pidDeB);
    await a!.query("ROLLBACK");
    expect((await esperando).rowCount).toBe(1);
    await b!.query("COMMIT");
    expect(await cuantos("VersionDeOpcion", `"opcionId" = '${e.chicoId}' AND "numero" = 2`)).toBe(1);
    // Con COMMIT de la primera, sobre el número 3, la segunda pierde.
    await a!.query("BEGIN");
    const tercera = version({ numero: 3 });
    await a!.query(tercera.texto, tercera.params);
    await b!.query("BEGIN");
    const cuarta = version({ numero: 3 });
    const perdedora = b!.query(cuarta.texto, cuarta.params).then(() => "entró" as const, (error: { code?: string; constraint?: string }) => `${error.code}|${error.constraint}`);
    await esperarBloqueo(pidDeB);
    await a!.query("COMMIT");
    expect(await perdedora).toBe(`23505|${UNICO_NUMERO}`);
    await b!.query("ROLLBACK");
    expect(await cuantos("VersionDeOpcion", `"opcionId" = '${e.chicoId}'`)).toBe(3);
  });

  it("versiones de opciones distintas, o números distintos de la misma opción, NO se estorban: entran todas", async () => {
    const todos = await clientes(4);
    const sentencias = [
      version({ numero: 2 }),
      version({ numero: 3 }),
      sentenciaDeVersionDeOpcion({ opcionId: e.medianoId, usuarioId: e.usuarioId }, { numero: 2 }),
      sentenciaDeVersionDeOpcion({ opcionId: e.grandeId, usuarioId: e.usuarioId }, { numero: 2 }),
    ];
    expect(await Promise.all(sentencias.map((s, i) => probar(todos[i]!, s)))).toEqual([null, null, null, null]);
  });
});

describe("la misma grilla y el mismo apagado a la vez: una sola fila", () => {
  it("dos y ocho altas del mismo precio por (sucursal, producto, opción): queda UNA fila y las demás reciben 23505", async () => {
    for (const n of [2, 8]) {
      await prismaAdmin.precioLocalDeOpcion.deleteMany();
      const todos = await clientes(n);
      const resultados = await Promise.all(todos.map((c, i) => probar(c, sentenciaDePrecioLocal({ sucursalId: e.sucursalA, productoId: e.cafeId, opcionId: e.grandeId }, { precio: `${100 + i}.00` }))));
      expect(resultados.filter((r) => r === null), `${n} clientes`).toHaveLength(1);
      expect(resultados.filter((r) => r?.codigo === "23505" && r.restriccion === UNICO_PRECIO), `${n} clientes`).toHaveLength(n - 1);
      expect(await cuantos("PrecioLocalDeOpcion"), `${n} clientes`).toBe(1);
    }
  });

  it("dos y ocho apagados del mismo (sucursal, opción): con INSERT queda UNA fila (23505 en las demás); con `ON CONFLICT DO UPDATE` todas terminan bien y sigue habiendo UNA fila", async () => {
    for (const n of [2, 8]) {
      await prismaAdmin.opcionApagadaEnSucursal.deleteMany();
      const todos = await clientes(n);
      const resultados = await Promise.all(todos.map((c) => probar(c, sentenciaDeApagado({ sucursalId: e.sucursalA, opcionId: e.shotId, usuarioId: e.usuarioId }))));
      expect(resultados.filter((r) => r === null), `${n} clientes`).toHaveLength(1);
      expect(resultados.filter((r) => r?.codigo === "23505" && r.restriccion === UNICO_APAGADO), `${n} clientes`).toHaveLength(n - 1);
      expect(await cuantos("OpcionApagadaEnSucursal"), `${n} clientes`).toBe(1);
    }
    await prismaAdmin.opcionApagadaEnSucursal.deleteMany();
    const otros = await clientes(8);
    const alta = (apagada: boolean) => ({
      texto: `INSERT INTO "OpcionApagadaEnSucursal" ("id", "sucursalId", "opcionId", "apagada", "actualizadoPorId") VALUES ($1, $2, $3, $4, $5)
              ON CONFLICT ("sucursalId", "opcionId") DO UPDATE SET "apagada" = EXCLUDED."apagada", "actualizadoEn" = now()`,
      params: [randomUUID(), e.sucursalA, e.shotId, apagada, e.usuarioId],
    });
    expect(await Promise.all(otros.map((c, i) => probar(c, alta(i % 2 === 0))))).toEqual(Array(8).fill(null));
    expect(await cuantos("OpcionApagadaEnSucursal")).toBe(1);
  });
});

describe("dos mozos, la misma configuración: las dos líneas quedan y se agrupan en una sola clave (I8)", () => {
  it("dos mozos con claves de idempotencia DISTINTAS agregan un café con la MISMA huella a la vez: quedan las dos líneas, y `claveDeLineaDeVentaConOpciones` da la misma clave", async () => {
    const [a, b] = await clientes(2);
    const resultados = await Promise.all([a!, b!].map((c) => bloque(c, bloqueDeAgregar(randomUUID()))));
    expect(resultados).toEqual([null, null]);
    expect(await estado()).toEqual({ comprobantes: 2, lineas: 4, fotos: 4 });
    const padres = await prismaAdmin.cuentaItem.findMany({ where: { lineaPadreId: null } });
    expect(padres).toHaveLength(2);
    const claves = padres.map((p) => claveDeLineaDeVentaConOpciones({ productoId: p.productoId, precioUnitario: Number(p.precioUnitario), huellaOpciones: p.huellaOpciones }));
    expect(new Set(claves).size, "la misma configuración es una sola línea de venta").toBe(1);
  });
});

describe("idempotencia del bloque «comprobante + padre + foto + adicional + foto»", () => {
  it("la misma clave dos veces seguidas: queda UN bloque completo y el segundo intento da 23505 sobre el comprobante, sin dejar nada", async () => {
    const app = await conexionComoApp(undefined, alcanceA());
    const clave = randomUUID();
    expect(await bloque(app, bloqueDeAgregar(clave))).toBeNull();
    const completo = { comprobantes: 1, lineas: 2, fotos: 2 };
    expect(await estado()).toEqual(completo);
    expect(await bloque(app, bloqueDeAgregar(clave))).toEqual({ codigo: "23505", restriccion: UNICO_CLAVE });
    expect(await estado(), "el segundo intento no dejó ni una línea ni una foto").toEqual(completo);
  });

  it("la misma clave a la vez (2 y 8 clientes): queda UN bloque completo; los demás reciben 23505 y no dejan nada", async () => {
    for (const n of [2, 8]) {
      await limpiarBloques();
      const todos = await clientes(n);
      const clave = randomUUID();
      const resultados = await Promise.all(todos.map((c) => bloque(c, bloqueDeAgregar(clave))));
      expect(resultados.filter((r) => r === null), `${n} clientes`).toHaveLength(1);
      expect(resultados.filter((r) => r?.codigo === "23505" && r.restriccion === UNICO_CLAVE), `${n} clientes`).toHaveLength(n - 1);
      expect(await estado(), `${n} clientes`).toEqual({ comprobantes: 1, lineas: 2, fotos: 2 });
    }
  });

  it("la misma clave en OTRA cuenta da 23505: la clave es global, no por cuenta", async () => {
    const app = await conexionComoApp(undefined, alcanceA());
    const clave = randomUUID();
    expect(await bloque(app, bloqueDeAgregar(clave))).toBeNull();
    expect(await bloque(app, bloqueDeAgregar(clave, { cuentaId: e.cuentaAOtraId }))).toEqual({ codigo: "23505", restriccion: UNICO_CLAVE });
    expect(await estado()).toEqual({ comprobantes: 1, lineas: 2, fotos: 2 });
  });
});

describe("atomicidad (I12): o entra todo o no entra nada", () => {
  it("un adicional inválido (precio $0) al final del bloque no deja el comprobante, ni el padre, ni la foto", async () => {
    const app = await conexionComoApp(undefined, alcanceA());
    expect(await bloque(app, bloqueDeAgregar(randomUUID(), { precioDelAdicional: "0.00" }))).toEqual({ codigo: "23514", restriccion: "CuentaItem_adicional_chk" });
    expect(await estado()).toEqual({ comprobantes: 0, lineas: 0, fotos: 0 });
    expect(await bloque(app, bloqueDeAgregar(randomUUID()))).toBeNull();
    expect(await estado(), "el bloque bien armado después sí entra").toEqual({ comprobantes: 1, lineas: 2, fotos: 2 });
  });

  it("una foto incoherente en el medio del bloque (la variante de otra opción) deshace el comprobante y las líneas ya escritas", async () => {
    const app = await conexionComoApp(undefined, alcanceA());
    const sentencias = [...bloqueDeAgregar(randomUUID())];
    const padreId = sentencias[1]!.params[0] as string;
    sentencias[2] = sentenciaDeFoto({ ...e, cuentaItemId: padreId }, { versionDeOpcionId: e.versionDe[e.almendrasId]! });
    expect(await bloque(app, sentencias)).toEqual({ codigo: "23514", restriccion: "OpcionElegidaEnLinea_version_de_la_opcion_chk" });
    expect(await estado()).toEqual({ comprobantes: 0, lineas: 0, fotos: 0 });
  });

  it("el bloque de cierre (operación padre e hija, movimiento del Kardex y el enlace de la línea) con la hija inválida no deja nada; bien armado, entra completo", async () => {
    const padreLinea = sentenciaDeLinea({ cuentaId: e.cuentaAId, productoId: e.cafeId }, { huellaOpciones: HUELLA_DE_PRUEBA });
    const hijaLinea = sentenciaDeLinea({ cuentaId: e.cuentaAId, productoId: e.anclaDelShotId }, { precioUnitario: "200.00", lineaPadreId: padreLinea.id });
    const app = await conexionComoApp(undefined, alcanceA());
    expect(await bloque(app, [padreLinea, hijaLinea])).toBeNull();
    const operacion = (id: string, extra: Record<string, unknown> = {}) => ({
      texto: `INSERT INTO "Operacion" ("id", "sucursalId", "proceso", "fecha", "usuarioId", "operacionPadreId", "promoCuentaId") VALUES ($1, $2, 'VENTA', now(), $3, $4, $5)`,
      params: [id, e.sucursalA, e.usuarioId, extra.operacionPadreId ?? null, extra.promoCuentaId ?? null],
    });
    const movimiento = (operacionId: string) => ({
      texto: `INSERT INTO "MovimientoStock" ("id", "operacionId", "productoId", "seccionId", "proceso", "cantidad", "detalle") VALUES ($1, $2, $3, $4, 'VENTA', -1, 'Venta de prueba')`,
      params: [randomUUID(), operacionId, e.cafeId, e.seccionA],
    });
    const enlace = (lineaId: string, operacionId: string) => ({ texto: `UPDATE "CuentaItem" SET "operacionId" = $2, "numeroEnvio" = 1 WHERE "id" = $1`, params: [lineaId, operacionId] });
    const padre = randomUUID();
    const hija = randomUUID();
    const invalido = [operacion(padre), movimiento(padre), enlace(padreLinea.id, padre), operacion(hija, { operacionPadreId: padre, promoCuentaId: "una-promo" })];
    expect(await bloque(app, invalido)).toEqual({ codigo: "23514", restriccion: "Operacion_padre_solo_venta_chk" });
    expect([await cuantos("Operacion"), await cuantos("MovimientoStock"), await cuantos("CuentaItem", `"operacionId" IS NOT NULL`)], "no quedó ni la operación padre, ni el movimiento, ni el enlace").toEqual([0, 0, 0]);
    const valido = [operacion(padre), movimiento(padre), enlace(padreLinea.id, padre), operacion(hija, { operacionPadreId: padre }), movimiento(hija), enlace(hijaLinea.id, hija)];
    expect(await bloque(app, valido)).toBeNull();
    expect([await cuantos("Operacion"), await cuantos("MovimientoStock"), await cuantos("CuentaItem", `"operacionId" IS NOT NULL`), await cuantos("Operacion", `"operacionPadreId" = '${padre}'`)]).toEqual([2, 2, 2, 1]);
  });
});
