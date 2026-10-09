import { afterEach, describe, expect, it, vi } from "vitest";
import { leerBcra, leerDolarApi, leerHistorial } from "../../src/core/reportes/cotizacion-dolar";
import { leerSerieDeLaApi } from "../../src/core/reportes/indices-economicos";
import { pedirDolarDeHoy, pedirHistorialDelDolar } from "../../src/server/adaptadores/cotizaciones/dolar";
import { pedirSerieDelIPC } from "../../src/server/adaptadores/cotizaciones/ipc";

/**
 * S-30: lo que escribe un TERCERO (las APIs del dólar y del IPC) lo leen TODAS las empresas (`CotizacionDolar` e `IndicePrecio` son globales), así que todo dato externo
 * es input no confiable: fechas del futuro, valores implausibles, redirecciones y respuestas sin tope de tamaño. Estos son los ataques; los que no tienen base corren acá.
 * `AHORA` es una constante del test (el cálculo recibe el reloj por parámetro): "hoy" en Argentina es 2026-09-18.
 */
const AHORA = new Date("2026-09-18T22:00:00Z");

describe("dolarapi.com: leerDolarApi no acepta fechas del futuro ni valores implausibles", () => {
  it("una `fechaActualizacion` de mañana (en horario argentino) no sirve; la de hoy sí, aunque en UTC ya sea el día siguiente", () => {
    expect(leerDolarApi({ compra: 1485, venta: 1535, fechaActualizacion: "2026-09-19T15:00:00.000Z" }, AHORA)).toBeNull();
    expect(leerDolarApi({ venta: 1535, fechaActualizacion: "2099-01-01T00:00:00.000Z" }, AHORA)).toBeNull();
    // 02:30 UTC del 19 es 23:30 del 18 en Argentina: es HOY
    expect(leerDolarApi({ venta: 1535, fechaActualizacion: "2026-09-19T02:30:00.000Z" }, AHORA)).toMatchObject({ fecha: "2026-09-18", venta: 1535 });
  });

  it("una venta absurda (1e9, que además no entra en Decimal(12,4)) no sirve; una compra absurda se ignora y la venta válida se conserva", () => {
    expect(leerDolarApi({ venta: 1e9, fechaActualizacion: "2026-09-18T18:55:00.000Z" }, AHORA)).toBeNull();
    expect(leerDolarApi({ compra: 1e9, venta: 1535, fechaActualizacion: "2026-09-18T18:55:00.000Z" }, AHORA)).toEqual({ fecha: "2026-09-18", compra: null, venta: 1535, fuente: "BNA" });
  });
});

describe("BCRA: leerBcra valida la fecha (formato, calendario y que no sea futura) y el valor", () => {
  const bcra = (fecha: unknown, tipoCotizacion: unknown = 1514.5) => ({ results: [{ fecha, detalle: [{ tipoCotizacion }] }] });

  it("una fecha futura, mal formada o que no existe en el calendario no sirve", () => {
    expect(leerBcra(bcra("2026-09-19"), AHORA)).toBeNull();
    expect(leerBcra(bcra("2099-01-01"), AHORA)).toBeNull();
    expect(leerBcra(bcra("2026-9-1"), AHORA)).toBeNull();
    expect(leerBcra(bcra("2026-09-18T00:00:00Z"), AHORA)).toBeNull();
    expect(leerBcra(bcra("2026-02-30"), AHORA)).toBeNull();
    expect(leerBcra(bcra("hoy"), AHORA)).toBeNull();
  });

  it("un valor de 1e9 no sirve; el de hoy y el de ayer sí", () => {
    expect(leerBcra(bcra("2026-09-18", 1e9), AHORA)).toBeNull();
    expect(leerBcra(bcra("2026-09-18"), AHORA)).toMatchObject({ fecha: "2026-09-18", venta: 1514.5, fuente: "BCRA" });
    expect(leerBcra(bcra("2026-09-17"), AHORA)).toMatchObject({ fecha: "2026-09-17" });
  });
});

describe("historial de argentinadatos: leerHistorial descarta lo futuro, lo mal formado y lo absurdo", () => {
  it("solo quedan las filas con fecha real, hasta hoy, y valores acotados", () => {
    const dias = leerHistorial(
      [
        { fecha: "2026-09-16", compra: 1480, venta: 1530 },
        { fecha: "2026-09-17", compra: 1485, venta: 1535 },
        { fecha: "2026-09-18", compra: 1485, venta: 1535 },
        { fecha: "2026-09-19", compra: 1485, venta: 1535 }, // mañana
        { fecha: "2099-01-01", compra: 1485, venta: 1535 }, // el futuro lejano
        { fecha: "2026-9-1", compra: 1485, venta: 1535 }, // mal formada
        { fecha: "2026-02-30", compra: 1485, venta: 1535 }, // no existe
        { fecha: "2026-09-15", compra: 1485, venta: 1e9 }, // implausible
      ],
      "2026-01-01",
      AHORA
    );
    expect(dias.map((d) => d.fecha)).toEqual(["2026-09-16", "2026-09-17", "2026-09-18"]);
  });
});

describe("IPC: leerSerieDeLaApi valida mes (primer día, no futuro) y un valor del tamaño de Decimal(12,4)", () => {
  it("un IPC de 1e9, un mes futuro y una fecha que no es el primer día del mes se saltean; el resto se conserva", () => {
    const filas = leerSerieDeLaApi(
      {
        data: [
          ["2026-01-01", 1e9],
          ["2099-01-01", 100],
          ["2026-10-01", 100], // el mes que viene
          ["2026-01-15", 100],
          ["2026-1-1", 100],
          ["2026-02-01", 100],
          ["2026-09-01", 120],
        ],
      },
      AHORA
    );
    expect(filas.map((f) => f.mes.toISOString().slice(0, 10))).toEqual(["2026-02-01", "2026-09-01"]);
  });
});

/** Un cuerpo JSON válido de `bytes` bytes (un arreglo de unos), servido como un pedido real: `Response` con su `body`. */
function respuestaDe(bytes: number, cabeceras: Record<string, string> = {}): Response {
  const cuerpo = "[" + "1,".repeat(Math.ceil(bytes / 2)) + "1]";
  return new Response(cuerpo, { status: 200, headers: { "content-type": "application/json", ...cabeceras } });
}

describe("los adaptadores de terceros piden con tope de tamaño y sin seguir redirecciones", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("una respuesta de 5 MB se rechaza (antes se leía entera con `resp.json()`)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuestaDe(5 * 1024 * 1024)));
    await expect(pedirHistorialDelDolar()).rejects.toThrow();
    await expect(pedirSerieDelIPC()).rejects.toThrow();
  });

  it("una respuesta que declara 5 MB en `content-length` se rechaza sin leerla", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuestaDe(10, { "content-length": String(5 * 1024 * 1024) })));
    await expect(pedirDolarDeHoy()).rejects.toThrow();
  });

  it("el pedido va con `redirect: \"error\"` (un 302 hacia otro host no se sigue)", async () => {
    const pedidos: Array<[string, RequestInit | undefined]> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        pedidos.push([url, init]);
        return new Response("{}", { status: 200 });
      })
    );
    await pedirDolarDeHoy();
    await pedirSerieDelIPC();
    expect(pedidos).toHaveLength(2);
    for (const [, init] of pedidos) expect(init?.redirect).toBe("error");
  });
});
