import { describe, expect, it } from "vitest";
import { armarTicket, armarTicketImpresoEn, armarTicketVigente } from "../../src/core/pos/ticket";

/**
 * `armarTicket`/`armarTicketImpresoEn`/`armarTicketVigente` con el % de descuento de cliente (Task #14, docs/plan-clientes-
 * descuento-2026-09-26.md, punto 3): PURO — sin base — a diferencia de test/pos/ticket.test.ts (que ejercita `cerrarCuenta` contra
 * Postgres real). Verifica que el snapshot recalculado acá (`precioConDescuento`, src/core/moneda.ts) reproduce lo que
 * `cerrarCuenta` registró, sin tener que leer el `MovimientoStock` de cada línea.
 */
const ITEM = (cantidad: number, precioUnitario: number) => ({ productoId: "p1", productoNombre: "Milanesa", cantidad, precioUnitario });

describe("armarTicket — sin descuento (comportamiento de siempre, sin tocar)", () => {
  it("null: precioUnitario/subtotal quedan en el precio de lista, sin precioListaUnitario", () => {
    const { lineas, total } = armarTicket([ITEM(2, 9000)], null);
    expect(lineas).toEqual([{ producto: "Milanesa", cantidad: 2, precioUnitario: 9000, subtotal: 18000 }]);
    expect(lineas[0]).not.toHaveProperty("precioListaUnitario");
    expect(total).toBe(18000);
  });

  it("sin el argumento (default): mismo resultado que null", () => {
    expect(armarTicket([ITEM(2, 9000)])).toEqual(armarTicket([ITEM(2, 9000)], null));
  });
});

describe("armarTicket — con descuento de cliente", () => {
  it("15% sobre 1000: precioUnitario 850, precioListaUnitario 1000 (difieren)", () => {
    const { lineas, total } = armarTicket([ITEM(1, 1000)], 15);
    expect(lineas).toEqual([{ producto: "Milanesa", cantidad: 1, precioUnitario: 850, precioListaUnitario: 1000, subtotal: 850 }]);
    expect(total).toBe(850);
  });

  it("0%: coincide con el de lista — NO se guarda precioListaUnitario (mismo criterio que precioConDescuento)", () => {
    const { lineas } = armarTicket([ITEM(1, 1000)], 0);
    expect(lineas[0]).not.toHaveProperty("precioListaUnitario");
    expect(lineas[0].precioUnitario).toBe(1000);
  });

  it("varias líneas netas: cada una con SU propio recálculo, agrupadas igual que sin descuento", () => {
    const { lineas, total } = armarTicket(
      [ITEM(3, 9000), ITEM(1, 3000), { productoId: "p1", productoNombre: "Milanesa", cantidad: 1, precioUnitario: 9500 }],
      10
    );
    expect(lineas).toEqual([
      { producto: "Milanesa", cantidad: 3, precioUnitario: 8100, precioListaUnitario: 9000, subtotal: 24300 },
      { producto: "Milanesa", cantidad: 1, precioUnitario: 2700, precioListaUnitario: 3000, subtotal: 2700 },
      { producto: "Milanesa", cantidad: 1, precioUnitario: 8550, precioListaUnitario: 9500, subtotal: 8550 },
    ]);
    expect(total).toBe(35550);
  });

  it("piso de 0,01 (Task #14): un descuento altísimo nunca da una línea en 0", () => {
    const { lineas } = armarTicket([ITEM(1, 1)], 99.99);
    expect(lineas[0].precioUnitario).toBe(0.01);
    expect(lineas[0].precioListaUnitario).toBe(1);
  });
});

describe("armarTicketImpresoEn / armarTicketVigente: el % viaja como tercer argumento", () => {
  const items = [{ ...ITEM(2, 1000), operacionId: "op1", anuladaEn: null }];

  it("armarTicketImpresoEn aplica el % a las líneas vigentes en ese instante", () => {
    const { lineas } = armarTicketImpresoEn(items, new Date("2026-01-01"), 20);
    expect(lineas[0]).toMatchObject({ precioUnitario: 800, precioListaUnitario: 1000 });
  });

  it("armarTicketVigente (ahora) también lo aplica", () => {
    const { lineas } = armarTicketVigente(items, 20);
    expect(lineas[0]).toMatchObject({ precioUnitario: 800, precioListaUnitario: 1000 });
  });

  it("sin el argumento: ninguna de las dos rompe (default null, sin descuento)", () => {
    expect(armarTicketImpresoEn(items, new Date("2026-01-01")).lineas[0]).not.toHaveProperty("precioListaUnitario");
    expect(armarTicketVigente(items).lineas[0]).not.toHaveProperty("precioListaUnitario");
  });
});
