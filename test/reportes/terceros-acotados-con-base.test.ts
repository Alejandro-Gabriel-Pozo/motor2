import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn(), flush: vi.fn(async () => true) }));
import { limpiarBaseDeTest, prisma } from "../setup/test-db";
import { sincronizarDolar, sincronizarIPC } from "../../src/server/actions/reportes/sincronizaciones";

/**
 * S-30, de punta a punta con base: lo que una API de terceros devuelve (un historial con fechas del futuro y un salto del 80 %, un IPC de 1e9 o de un mes que no llegó, una
 * respuesta de 5 MB) NO llega a las tablas globales `CotizacionDolar` e `IndicePrecio`, que leen todas las empresas. El dólar corre con un `ahora` inyectado (2026-09-18, en el pasado
 * del reloj real); el IPC con fechas relativas a hoy.
 */
const AHORA = new Date("2026-09-18T22:00:00Z");

/** El servidor responde con una `Response` real (con su `body`), como lo hace `fetch`: así el adaptador lee un cuerpo de verdad. */
function simularRed(rutas: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const r = rutas[new URL(url).host];
      if (r === undefined) throw new Error(`sin ruta simulada para ${new URL(url).host}`);
      return new Response(JSON.stringify(r), { status: 200 });
    })
  );
}

describe("sincronizarDolar: un tercero escribe fechas futuras y saltos absurdos en el historial", () => {
  beforeEach(limpiarBaseDeTest);
  afterEach(() => vi.unstubAllGlobals());

  it("el día del futuro y el salto de 80 % del historial NO se guardan (se avisan); los días normales sí", async () => {
    simularRed({
      "api.argentinadatos.com": [
        { fecha: "2026-09-15", compra: 1470, venta: 1520 },
        { fecha: "2026-09-16", compra: 1480, venta: 1530 },
        { fecha: "2026-09-17", compra: 2650, venta: 2750 }, // +80 % de un día para el otro, sin otra fuente que lo confirme
        { fecha: "2026-09-18", compra: 1485, venta: 1535 },
        { fecha: "2026-09-25", compra: 1490, venta: 1540 }, // el futuro
      ],
      "dolarapi.com": { compra: 1485, venta: 1535, fechaActualizacion: "2026-09-18T18:55:00.000Z" },
    });
    const r = await sincronizarDolar(prisma, AHORA);
    const guardadas = await prisma.cotizacionDolar.findMany({ orderBy: { fecha: "asc" }, select: { fecha: true, venta: true } });
    expect(guardadas.map((g) => g.fecha.toISOString().slice(0, 10))).toEqual(["2026-09-15", "2026-09-16", "2026-09-18"]);
    expect(guardadas.map((g) => Number(g.venta))).toEqual([1520, 1530, 1535]);
    expect(r.errores.some((e) => /cotización descartada/.test(e))).toBe(true);
  });

  // M-35 (T16): con la tabla vacía el primer día del relleno no tenía con qué compararse (`previo = null`) y solo lo acotaba el tope de 1.000.000: un primer valor absurdo quedaba guardado Y como
  // base de todas las comparaciones siguientes (los días buenos que venían después se descartaban por «saltar» contra él).
  it("EL DEFECTO (M-35): con la tabla vacía, un primer día absurdo del historial NO se guarda ni sirve de ancla: los días normales que siguen sí se guardan", async () => {
    simularRed({
      "api.argentinadatos.com": [
        { fecha: "2026-09-15", compra: 490_000, venta: 500_000 }, // el primer día, sin dato previo: dentro del tope de 1.000.000 pero absurdo
        { fecha: "2026-09-16", compra: 1480, venta: 1530 },
        { fecha: "2026-09-17", compra: 1482, venta: 1532 },
      ],
      "dolarapi.com": { compra: 1485, venta: 1535, fechaActualizacion: "2026-09-18T18:55:00.000Z" },
    });
    const r = await sincronizarDolar(prisma, AHORA);
    const guardadas = await prisma.cotizacionDolar.findMany({ orderBy: { fecha: "asc" }, select: { fecha: true, venta: true } });
    expect(guardadas.map((g) => Number(g.venta))).toEqual([1530, 1532, 1535]);
    expect(guardadas.some((g) => g.fecha.toISOString().startsWith("2026-09-15"))).toBe(false);
    expect(r.errores.some((e) => /cotización descartada/.test(e))).toBe(true);
  });

  it("con la tabla vacía, el dólar de HOY absurdo de una sola fuente no se guarda (la corrida falla)", async () => {
    simularRed({ "api.argentinadatos.com": [], "dolarapi.com": { compra: 490_000, venta: 500_000, fechaActualizacion: "2026-09-18T18:55:00.000Z" }, "api.bcra.gob.ar": {} });
    await expect(sincronizarDolar(prisma, AHORA)).rejects.toThrow(/No se pudo obtener el dólar/);
    expect(await prisma.cotizacionDolar.count()).toBe(0);
  });

  it("dolarapi con la fecha de mañana no se guarda: sin otra fuente la corrida falla y no queda ninguna fila futura", async () => {
    await prisma.cotizacionDolar.create({ data: { fecha: new Date("2026-09-17T00:00:00Z"), fuente: "BNA", compra: 1485, venta: 1535 } });
    simularRed({ "dolarapi.com": { compra: 1485, venta: 1535, fechaActualizacion: "2026-09-19T15:00:00.000Z" } });
    await expect(sincronizarDolar(prisma, AHORA)).rejects.toThrow(/No se pudo obtener el dólar/);
    expect(await prisma.cotizacionDolar.count()).toBe(1);
  });

  it("una respuesta de 5 MB del historial no se lee: el relleno falla con su aviso y la cotización de hoy sí se guarda", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const host = new URL(url).host;
        if (host === "api.argentinadatos.com") return new Response("[" + "1,".repeat(2_700_000) + "1]", { status: 200 });
        if (host === "dolarapi.com") return new Response(JSON.stringify({ compra: 1485, venta: 1535, fechaActualizacion: "2026-09-18T18:55:00.000Z" }), { status: 200 });
        throw new Error(`sin ruta simulada para ${host}`);
      })
    );
    const r = await sincronizarDolar(prisma, AHORA);
    expect(r.diasRellenados).toBe(0);
    expect(r.errores.some((e) => e.startsWith("historial:"))).toBe(true);
    expect(await prisma.cotizacionDolar.count()).toBe(1);
  });
});

describe("sincronizarIPC: un tercero escribe valores implausibles y meses que todavía no llegaron", () => {
  const hoy = new Date();
  /** "YYYY-MM-01" del mes que queda `atras` meses antes del actual (negativo: después). */
  const mesApi = (atras: number) => new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - atras, 1)).toISOString().slice(0, 10);

  beforeEach(limpiarBaseDeTest);
  afterEach(() => vi.unstubAllGlobals());

  it("un IPC de 1e9 (no entra en Decimal(12,4)) y el mes que viene no se guardan; los meses válidos sí", async () => {
    simularRed({
      "apis.datos.gob.ar": {
        data: [
          [mesApi(3), 100],
          [mesApi(2), 1e9],
          [mesApi(-1), 120],
          [mesApi(1), 110],
        ],
      },
    });
    const r = await sincronizarIPC(prisma, hoy);
    expect(r.mesesNuevos).toBe(2);
    const guardados = await prisma.indicePrecio.findMany({ orderBy: { mes: "asc" }, select: { mes: true } });
    expect(guardados.map((g) => g.mes.toISOString().slice(0, 10))).toEqual([mesApi(3), mesApi(1)]);
  });

  it("una respuesta de 5 MB se rechaza y no se guarda nada", async () => {
    // JSON válido y con una serie legítima al principio: el tamaño es lo único malo (si se leyera entera, el primer mes se guardaría)
    vi.stubGlobal("fetch", vi.fn(async () => new Response(`{"data":[["${mesApi(1)}",100]` + ',"x"'.repeat(1_300_000) + "]}", { status: 200 })));
    await expect(sincronizarIPC(prisma, hoy)).rejects.toThrow();
    expect(await prisma.indicePrecio.count()).toBe(0);
  });
});
