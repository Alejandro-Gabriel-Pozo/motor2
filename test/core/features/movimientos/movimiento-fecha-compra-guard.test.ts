import { describe, expect, it } from "vitest";
import { guardComandoRegistrarMovimiento } from "../../../../src/core/features/movimientos/movimiento.guard";
import { mediodiaDelDia, ZONA_ARGENTINA } from "../../../../src/core/tiempo/zona-horaria";

/** I13 (etapa 1 de Compras): la fecha de una COMPRA no es posterior a hoy; los demás procesos conservan el día de margen de `validarFechaOperacion`. */
const AHORA = new Date("2026-10-28T15:00:00.000Z"); // 12:00 del 28/10 en Argentina
const HOY = mediodiaDelDia("2026-10-28", ZONA_ARGENTINA);
const MANANA = mediodiaDelDia("2026-10-29", ZONA_ARGENTINA);
const MENSAJE = "La fecha de la compra no puede ser posterior a hoy.";

const entrada = (proceso: string, fecha: Date) => ({ proceso, fecha, seccionId: "s", items: [{ productoId: "p", cantidad: 1 }], claveIdempotencia: crypto.randomUUID() });

describe("guardComandoRegistrarMovimiento: fecha de la COMPRA (I13)", () => {
  it("una COMPRA con fecha de mañana se rechaza con el mensaje de la compra", () => {
    expect(guardComandoRegistrarMovimiento(entrada("COMPRA", MANANA), AHORA)).toEqual({ ok: false, codigo: "rango", mensaje: MENSAJE });
  });

  it("una COMPRA con fecha de hoy no se rechaza por la fecha", () => {
    const r = guardComandoRegistrarMovimiento(entrada("COMPRA", HOY), AHORA);
    expect(r.ok === false && r.mensaje === MENSAJE).toBe(false);
  });

  it("una MERMA con fecha de mañana sigue pasando (el día de margen no se tocó para los demás procesos)", () => {
    expect(guardComandoRegistrarMovimiento(entrada("MERMA", MANANA), AHORA).ok).toBe(true);
  });
});
