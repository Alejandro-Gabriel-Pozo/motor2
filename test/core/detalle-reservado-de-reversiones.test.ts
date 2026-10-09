import { describe, expect, it } from "vitest";
import { guardComandoRegistrarMovimiento } from "../../src/core/features/movimientos/movimiento.guard";
import { detalleReversionDeCompra, detalleReversionDeVenta, esDetalleReservadoParaReversiones } from "../../src/core/movimientos/anulaciones";
import { AHORA_DE_LA_CORRIDA } from "../setup/tiempo";

/**
 * M-1 de la auditoría intermedia (S-03, D7): la reversión por anulación de una venta o de una compra se reconoce SOLO por el comienzo de su `detalleLibre` («Anulación de la venta …»).
 * Si un ajuste MANUAL pudiera escribir un detalle así, se haría pasar por una reversión: no contaría como «posterior» a una venta (`OPERACION_QUE_NO_ES_REVERSION_POR_ANULACION`) y la venta
 * se podría anular a ciegas, deshaciendo un conteo o un ajuste que ya reconcilió el stock. El prefijo queda RESERVADO: el comando que recibe un detalle del cliente lo rechaza.
 *
 * El ataque (rojo contra el código anterior): `registrarMovimiento` de un AJUSTE con `detalleLibre: "Anulación de la venta <id> (2026-10-08)."` pasaba el guard.
 */
const item = { productoId: "p", cantidad: 1 };
const base = { proceso: "AJUSTE", items: [item], seccionId: "s", fecha: new Date() };
const guard = (detalleLibre?: string) => guardComandoRegistrarMovimiento({ ...base, detalleLibre }, AHORA_DE_LA_CORRIDA);

describe("el prefijo de las reversiones por anulación está reservado (M-1)", () => {
  it("un ajuste manual con el detalle de una reversión de venta o de compra se rechaza, también con otras mayúsculas o con espacios al comienzo", () => {
    for (const detalle of [
      detalleReversionDeVenta("ck123", new Date("2026-10-08T00:00:00Z")),
      detalleReversionDeCompra("ck456", new Date("2026-10-08T00:00:00Z"), "A-0001"),
      "Anulación de la venta cualquier cosa",
      "Anulación de la compra x",
      "   Anulación de la venta con espacios",
      "ANULACIÓN DE LA VENTA en mayúsculas",
    ]) {
      expect(guard(detalle), detalle).toMatchObject({ ok: false, codigo: "formato" });
    }
  });

  it("un detalle común, vacío o ausente sigue pasando, y uno que solo MENCIONA una anulación más adelante también", () => {
    expect(guard("Ajuste por rotura").ok).toBe(true);
    expect(guard("").ok).toBe(true);
    expect(guard(undefined).ok).toBe(true);
    expect(guard("Corrección posterior a la Anulación de la venta de ayer").ok).toBe(true);
  });

  it("el reconocedor coincide con lo que arman las acciones (una sola fuente: los prefijos de anulaciones.ts)", () => {
    expect(esDetalleReservadoParaReversiones(detalleReversionDeVenta("x", new Date()))).toBe(true);
    expect(esDetalleReservadoParaReversiones(detalleReversionDeCompra("x", new Date(), null))).toBe(true);
    expect(esDetalleReservadoParaReversiones("Anulación de la venta")).toBe(false); // sin el espacio final, no es el prefijo que filtran las consultas
    expect(esDetalleReservadoParaReversiones("Ajuste")).toBe(false);
  });
});
