import { describe, expect, it } from "vitest";
import { type ItemParaMargenReal } from "../../src/core/reportes/margen-real";
import { calcularMargenRealDelPeriodo } from "../../src/server/consultas/reportes/margen-real";
import type { Db } from "../../src/lib/db-tipos";

/**
 * Extensión ADITIVA de src/core/reportes/margen-real.ts (Task #16, docs/plan-promo-combo-2026-09-26.md, paso 2): `costoPorItem`,
 * el costo real resuelto de cada línea, alineado por índice con `items`. Con TODAS las líneas trayendo `costoUnitarioVenta` ya
 * congelado no hace falta reconstruir nada — `reconstruirCostosDeVenta` corta apenas ve `ventasSinCosto` vacío (costo-historico.ts,
 * l.61) sin tocar `db`, así que esta suite no necesita Postgres real (a diferencia del resto de `test/reportes/`, que sí
 * ejercita la reconstrucción). Los totales/porProducto ya los cubren periodo.test.ts/promociones.test.ts/
 * descuentos-clientes.test.ts, que siguen en verde sin tocarlos — acá solo se agrega cobertura del campo nuevo.
 */
const dbNoUsada = {} as Db;

function item(over: Partial<ItemParaMargenReal>): ItemParaMargenReal {
  return { proceso: "VENTA", anulada: false, productoId: "pv-1", cantidad: 1, precioTotal: 100, costoUnitarioVenta: 40, fecha: new Date("2026-01-01"), ...over };
}

describe("calcularMargenRealDelPeriodo — costoPorItem (paso 2, aditivo)", () => {
  it("una línea costeada: costoPorItem trae exacto cantidad × costoUnitarioVenta, en el mismo índice", async () => {
    const r = await calcularMargenRealDelPeriodo("suc-1", [item({ cantidad: 3, costoUnitarioVenta: 40, precioTotal: 300 })], dbNoUsada);
    expect(r.costoPorItem).toEqual([120]);
    expect(r.costoRealTotal).toBe(120);
  });

  it("alineación por índice: una línea excluida (anulada, sin precio, o de otro proceso) queda en null SIN correr el resto", async () => {
    const items: ItemParaMargenReal[] = [
      item({ productoId: "a", cantidad: 1, costoUnitarioVenta: 10, precioTotal: 50 }),
      item({ productoId: "b", anulada: true }),
      item({ productoId: "c", precioTotal: 0 }),
      item({ productoId: "d", proceso: "CONSUMO" }),
      item({ productoId: "e", cantidad: 2, costoUnitarioVenta: 30, precioTotal: 200 }),
    ];
    const r = await calcularMargenRealDelPeriodo("suc-1", items, dbNoUsada);
    expect(r.costoPorItem).toEqual([10, null, null, null, 60]);
  });

  it("lista vacía: costoPorItem vacío, sin tocar `db`", async () => {
    const r = await calcularMargenRealDelPeriodo("suc-1", [], dbNoUsada);
    expect(r.costoPorItem).toEqual([]);
  });
});
