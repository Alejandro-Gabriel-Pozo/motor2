import { describe, expect, it } from "vitest";
import { descripcionAuditoriaAnulacionDeVenta, detalleReversionDeCompra, detalleReversionDeVenta } from "../../src/core/movimientos/anulaciones";

/**
 * P1, paso 7: los textos que se GUARDAN al anular (el `detalleLibre` del contra-asiento y la descripción de la auditoría) citan el día de la operación en hora argentina. Una venta de las
 * 22:30 argentinas del 31/12 es del 31/12, aunque en UTC ya sea 1/1 (leída en UTC decía «2027-01-01», un día que para el negocio todavía no había empezado).
 */
describe("textos de anulación: el día de la operación es el argentino", () => {
  const casos: Array<[string, string, string]> = [
    ["las 22:30 argentinas del 6/8", "2026-08-07T01:30:00Z", "2026-08-06"],
    ["las 00:30 argentinas del 7/8 (en UTC es el mismo día)", "2026-08-07T03:30:00Z", "2026-08-07"],
    ["las 23:59:59 argentinas del 31/12 (cambio de año)", "2027-01-01T02:59:59Z", "2026-12-31"],
    ["las 21:00 argentinas del 29/2/2028 (año bisiesto)", "2028-03-01T00:00:00Z", "2028-02-29"],
    ["el mediodía argentino (lo que guardan los formularios)", "2026-08-06T15:00:00Z", "2026-08-06"],
  ];

  it.each(casos)("%s", (_nombre, instante, dia) => {
    const fecha = new Date(instante);
    expect(detalleReversionDeVenta("v1", fecha)).toBe(`Anulación de la venta v1 (${dia}).`);
    expect(detalleReversionDeCompra("c1", fecha, null)).toBe(`Anulación de la compra c1 (${dia}).`);
    expect(detalleReversionDeCompra("c1", fecha, "A-0001")).toBe(`Anulación de la compra c1 (${dia}, factura A-0001).`);
    expect(descripcionAuditoriaAnulacionDeVenta(fecha, null, false)).toBe(`Venta del ${dia}: anulación`);
    expect(descripcionAuditoriaAnulacionDeVenta(fecha, "F-1", true)).toBe(`Venta del ${dia} (factura F-1): anulación (promo, junto con sus otros componentes)`);
  });
});
