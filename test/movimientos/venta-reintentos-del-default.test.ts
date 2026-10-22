import { afterEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { registrarVentaCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/registrar-venta";

/**
 * Flake de la REGRESIÓN C2 (`test/auditoria/concurrencia-casos-2-3.test.ts`, 2026-10-22): dos ventas simultáneas con stock de sobra terminaban, de vez en cuando, con una rechazada por un
 * P2034 crudo («conflicto de escritura agotó los reintentos { maxIntentos: 5 }»). Causa: `registrarVentaCasoDeUso` le pasaba a `conTransaccionSerializable` un `maxIntentos` FIJO de 5 (lo
 * escribió O.249 para llegar por posición a `tambienChoqueDeUnico`, cuando 5 era el default), y O.350 subió el default a 8 sin ver esa llamada: la venta se quedó con el tope viejo. Bajo carga, los
 * dos contendientes pueden chocar en los 5 intentos seguidos (medido: hasta 7 rondas).
 *
 * Se prueba el caso de uso con una transacción armada a mano (sin base), con el jitter en 0 para no esperar: tiene que intentar las 8 veces del default.
 */
const conflictoDeEscritura = () => new Prisma.PrismaClientKnownRequestError("Transaction failed due to a write conflict", { code: "P2034", clientVersion: "test" });

const actor = (transaccion: ReturnType<typeof vi.fn>) =>
  ({ transaccion: Object.assign(transaccion, { aleatorio: () => 0 }), usuarioId: "u-prueba", sucursalId: "s-prueba", sucursalNombre: "Central" }) as unknown as Parameters<
    typeof registrarVentaCasoDeUso
  >[0];

const datos = { fecha: new Date("2026-10-22T12:00:00Z"), seccionId: "seccion", ventas: [{ productoId: "producto", cantidadVendida: 6 }] };

describe("registrarVenta: reintenta un conflicto de escritura con el default de conTransaccionSerializable (8), no con un tope propio", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("siete conflictos seguidos y el octavo intento sale: la venta tiene éxito", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const resultado = { ok: true, mensaje: "Venta registrada.", datos: { operacionIds: ["op"], repetida: false } };
    let llamadas = 0;
    const transaccion = vi.fn(async () => {
      if (++llamadas < 8) throw conflictoDeEscritura();
      return resultado;
    });
    await expect(registrarVentaCasoDeUso(actor(transaccion), datos)).resolves.toBe(resultado);
    expect(transaccion).toHaveBeenCalledTimes(8);
  });

  it("un conflicto en cada intento se agota a los 8 y sale como el P2034 (no se disfraza)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const transaccion = vi.fn(async () => {
      throw conflictoDeEscritura();
    });
    await expect(registrarVentaCasoDeUso(actor(transaccion), datos)).rejects.toMatchObject({ code: "P2034" });
    expect(transaccion).toHaveBeenCalledTimes(8);
  });
});
