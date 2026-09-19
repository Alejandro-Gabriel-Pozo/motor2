import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { limpiarBaseDeTest, prisma } from "../setup/test-db";
import {
  fechaArgentina,
  leerBcra,
  leerDolarApi,
  leerHistorial,
  obtenerUltimaCotizacion,
  pesosADolares,
  sincronizarDolar,
} from "../../src/core/reportes/cotizacion-dolar";

/**
 * Dólar oficial del BNA: se guarda una fila por día. Las respuestas de las APIs están copiadas de las reales (verificadas el
 * 2026-09-19) y las llamadas de red se reemplazan por respuestas fijas.
 */
const RESPUESTA_DOLARAPI = { moneda: "USD", casa: "oficial", nombre: "Oficial", compra: 1485, venta: 1535, fechaActualizacion: "2026-09-18T18:55:00.000Z" };
const RESPUESTA_BCRA = { status: 200, results: [{ fecha: "2026-09-18", detalle: [{ codigoMoneda: "USD", tipoCotizacion: 1514.5 }] }] };
const HISTORIAL = [
  { casa: "oficial", compra: 1470, venta: 1520, fecha: "2025-12-31" },
  { casa: "oficial", compra: 1480, venta: 1530, fecha: "2026-09-16" },
  { casa: "oficial", compra: 1485, venta: 1535, fecha: "2026-09-17" },
  { casa: "oficial", compra: 1485, venta: 1535, fecha: "2026-09-18" },
];

function simularRed(rutas: Record<string, unknown | Error>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const host = new URL(url).host;
      const r = rutas[host];
      if (r === undefined || r instanceof Error) throw r ?? new Error(`sin ruta simulada para ${host}`);
      return { ok: true, status: 200, json: async () => r };
    })
  );
}

describe("lectura de las respuestas", () => {
  it("dolarapi: compra, venta y el día en horario argentino (18:55 UTC es 15:55 del mismo día)", () => {
    expect(leerDolarApi(RESPUESTA_DOLARAPI)).toEqual({ fecha: "2026-09-18", compra: 1485, venta: 1535, fuente: "BNA" });
    expect(fechaArgentina(new Date("2026-09-19T02:30:00Z"))).toBe("2026-09-18"); // 23:30 del 18 en Argentina
  });

  it("dolarapi: una respuesta sin venta válida no sirve", () => {
    expect(leerDolarApi({ compra: 1485, venta: null })).toBeNull();
    expect(leerDolarApi({ venta: 0 })).toBeNull();
    expect(leerDolarApi(null)).toBeNull();
    expect(leerDolarApi({ venta: 1535, fechaActualizacion: "no es una fecha" })).toBeNull();
  });

  it("BCRA: un solo valor, que va en venta", () => {
    expect(leerBcra(RESPUESTA_BCRA)).toEqual({ fecha: "2026-09-18", compra: null, venta: 1514.5, fuente: "BCRA" });
    expect(leerBcra({ results: [] })).toBeNull();
  });

  it("historial: desde una fecha, en orden, ignorando filas inválidas", () => {
    const dias = leerHistorial([...HISTORIAL].reverse().concat([{ casa: "oficial", compra: 1, venta: NaN as unknown as number, fecha: "2026-09-19" }]), "2026-01-01");
    expect(dias.map((d) => d.fecha)).toEqual(["2026-09-16", "2026-09-17", "2026-09-18"]);
    expect(leerHistorial("no es una lista", "2026-01-01")).toEqual([]);
  });

  it("pesos a dólares con 2 decimales", () => {
    expect(pesosADolares(3_995_000, 1535)).toBe(2602.61);
  });
});

describe("sincronizarDolar", () => {
  beforeEach(limpiarBaseDeTest);
  afterEach(() => vi.unstubAllGlobals());

  it("con la tabla vacía rellena el historial del año y guarda hoy", async () => {
    simularRed({ "api.argentinadatos.com": HISTORIAL, "dolarapi.com": RESPUESTA_DOLARAPI });
    const r = await sincronizarDolar(prisma, new Date("2026-09-18T22:00:00Z"));

    expect(r.diasRellenados).toBe(3); // 2025-12-31 es de antes del 2026-01-01
    expect(r.fuente).toBe("BNA");
    expect(await prisma.cotizacionDolar.count()).toBe(3); // 16, 17 y 18 (hoy pisa al 18 del historial)
    const ultima = await obtenerUltimaCotizacion(prisma);
    expect(ultima).toMatchObject({ compra: 1485, venta: 1535, fuente: "BNA" });
    expect(ultima?.fecha.toISOString().slice(0, 10)).toBe("2026-09-18");
  });

  it("el mismo día se ACTUALIZA (queda la última corrida) y no se vuelve a pedir el historial", async () => {
    simularRed({ "api.argentinadatos.com": HISTORIAL, "dolarapi.com": RESPUESTA_DOLARAPI });
    await sincronizarDolar(prisma, new Date("2026-09-18T15:00:00Z"));

    simularRed({ "dolarapi.com": { ...RESPUESTA_DOLARAPI, compra: 1490, venta: 1540 } }); // sin argentinadatos: si lo pidiera, fallaría
    const r = await sincronizarDolar(prisma, new Date("2026-09-18T22:00:00Z"));

    expect(r.diasRellenados).toBe(0);
    expect(r.errores).toEqual([]);
    expect(await prisma.cotizacionDolar.count()).toBe(3);
    expect(await obtenerUltimaCotizacion(prisma)).toMatchObject({ compra: 1490, venta: 1540 });
  });

  it("si dolarapi cae, usa el BCRA para hoy y avisa el error", async () => {
    simularRed({ "api.argentinadatos.com": HISTORIAL, "dolarapi.com": new Error("timeout"), "api.bcra.gob.ar": RESPUESTA_BCRA });
    const r = await sincronizarDolar(prisma, new Date("2026-09-18T22:00:00Z"));

    expect(r.fuente).toBe("BCRA");
    expect(r.errores.join(" ")).toContain("dolarapi.com");
    expect(await prisma.cotizacionDolar.count({ where: { fuente: "BCRA" } })).toBe(1);
    // Con los dos valores del mismo día, la última cotización es la del BNA.
    expect(await obtenerUltimaCotizacion(prisma)).toMatchObject({ fuente: "BNA", venta: 1535 });
  });

  it("si cae el historial pero llega hoy, guarda hoy y avisa el error", async () => {
    simularRed({ "api.argentinadatos.com": new Error("caído"), "dolarapi.com": RESPUESTA_DOLARAPI });
    const r = await sincronizarDolar(prisma, new Date("2026-09-18T22:00:00Z"));
    expect(r.diasRellenados).toBe(0);
    expect(r.errores.join(" ")).toContain("historial");
    expect(await prisma.cotizacionDolar.count()).toBe(1);
  });

  it("si no hay ninguna fuente y nada se guardó, lanza (el cron responde 502)", async () => {
    simularRed({ "api.argentinadatos.com": new Error("caído"), "dolarapi.com": new Error("caído"), "api.bcra.gob.ar": new Error("caído") });
    await expect(sincronizarDolar(prisma, new Date("2026-09-18T22:00:00Z"))).rejects.toThrow(/No se pudo obtener el dólar/);
    expect(await prisma.cotizacionDolar.count()).toBe(0);
  });

  it("sin ninguna cotización guardada, obtenerUltimaCotizacion da null", async () => {
    expect(await obtenerUltimaCotizacion(prisma)).toBeNull();
  });
});
