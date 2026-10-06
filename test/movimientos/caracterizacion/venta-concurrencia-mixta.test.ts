import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, prisma } from "../../setup/test-db";
import { entrarComo, sembrarCuenta, sembrarSalon } from "../../pos/salon-fixture";
import { cerrarCuenta } from "../../../src/server/actions/pos/cuenta-cierre";
import { registrarMovimiento } from "../../../src/server/actions/movimientos/movimientos";
import { anularVenta, registrarVenta } from "../../../src/server/actions/movimientos/venta";

/**
 * CARACTERIZACIÓN de la venta bajo concurrencia (Fase 4, tramo A: la venta sale de `core/movimientos`; NO se edita en ningún paso posterior). Lo que ya cubren
 * otros archivos (dos cierres de la misma cuenta, la misma clave I3, el arrastre de redondeo) no se repite: acá van las dos carreras que faltaban.
 *
 *  1. La venta de MOSTRADOR y el cierre de una cuenta del POS a la vez sobre el MISMO insumo, con stock para UNA sola pizza: el mostrador rechaza si no hay
 *     stock y el POS lo permite (queda en negativo con aviso). Sea cual sea el orden, el Kardex tiene que quedar consistente: por cada venta que salió, una fila
 *     VENTA y una CONSUMO, y el saldo del insumo es exactamente lo comprado menos lo consumido por las que salieron (nada perdido, nada doble).
 *  2. Dos anulaciones SIMULTÁNEAS de la misma venta: una sola reversión (un juego de AJUSTE y una fila de auditoría); la otra ve la venta ya anulada.
 */
describe("venta: concurrencia entre mostrador y POS, y doble anulación", () => {
  let s: Awaited<ReturnType<typeof sembrarSalon>>;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    s = await sembrarSalon();
    await entrarComo(s.admin);
  });

  const saldoDe = async (productoId: string) => Number((await prisma.movimientoStock.aggregate({ where: { productoId }, _sum: { cantidad: true } }))._sum.cantidad ?? 0);

  it("mostrador y cierre del POS a la vez sobre la misma Muzzarella (stock para una pizza): el Kardex queda consistente en cualquier orden", async () => {
    for (let vuelta = 0; vuelta < 3; vuelta++) {
      await limpiarBaseDeTest();
      s = await sembrarSalon();
      await entrarComo(s.admin);
      // 0,25 kg de Muzzarella = exactamente UNA pizza.
      await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-09-01"), seccionId: s.seccion.id, items: [{ productoId: s.muzzarella.id, cantidad: 0.25, precioTotal: 100 }] });
      const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: s.pizza.id, cantidad: 1, precioUnitario: 12000, numeroEnvio: 1 }]);

      const [mostrador, pos] = await Promise.all([
        registrarVenta({ fecha: new Date("2026-09-28"), seccionId: s.seccion.id, ventas: [{ productoId: s.pizza.id, cantidadVendida: 1 }] }),
        cerrarCuenta(cuenta.id),
      ]);

      // El POS siempre sale (permite stock negativo); el mostrador sale solo si llegó primero.
      expect(pos.ok, pos.mensaje).toBe(true);
      if (!mostrador.ok) expect(mostrador.mensaje).toMatch(/^Stock insuficiente para "Muzzarella"/);
      const salieron = 1 + (mostrador.ok ? 1 : 0);

      expect(await prisma.movimientoStock.count({ where: { proceso: "VENTA", productoId: s.pizza.id } }), `vuelta ${vuelta}: filas VENTA`).toBe(salieron);
      expect(await prisma.movimientoStock.count({ where: { proceso: "CONSUMO", productoId: s.muzzarella.id } }), `vuelta ${vuelta}: filas CONSUMO`).toBe(salieron);
      expect(await saldoDe(s.muzzarella.id), `vuelta ${vuelta}: saldo de Muzzarella`).toBeCloseTo(0.25 - 0.25 * salieron, 6);
      expect(await prisma.operacion.count({ where: { proceso: "VENTA" } }), `vuelta ${vuelta}: operaciones de venta`).toBe(salieron);
    }
  }, 120_000);

  it("dos anulaciones simultáneas de la misma venta: una sola reversión y una sola fila de auditoría", async () => {
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-09-01"), seccionId: s.seccion.id, items: [{ productoId: s.muzzarella.id, cantidad: 2, precioTotal: 800 }] });
    const venta = await registrarVenta({ fecha: new Date("2026-09-28"), seccionId: s.seccion.id, ventas: [{ productoId: s.pizza.id, cantidadVendida: 2 }] });
    expect(venta.ok).toBe(true);
    const operacion = await prisma.operacion.findFirstOrThrow({ where: { proceso: "VENTA" } });
    const antes = await saldoDe(s.muzzarella.id);
    expect(antes).toBeCloseTo(1.5, 6); // 2 − 2 × 0,25

    const resultados = await Promise.all([anularVenta(operacion.id), anularVenta(operacion.id)]);

    expect(resultados.filter((r) => r.ok), JSON.stringify(resultados)).toHaveLength(1);
    expect(resultados.filter((r) => !r.ok).map((r) => r.mensaje)).toEqual(["Esta venta ya está anulada."]);
    expect(await saldoDe(s.muzzarella.id)).toBeCloseTo(2, 6); // el insumo vuelve UNA sola vez
    expect(await prisma.operacion.count({ where: { proceso: "AJUSTE" } })).toBe(1);
    expect(await prisma.registroAuditoria.count({ where: { entidad: "Operacion" } })).toBe(1);
  }, 60_000);
});
