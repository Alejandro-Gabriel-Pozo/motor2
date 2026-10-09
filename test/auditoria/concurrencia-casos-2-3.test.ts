import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Pivote 1 (Concurrencia) — casos 2 y 3 del plan de verificación, pendientes
 * tras la primera ronda (docs/auditoria-motor2-fase0-fase1-2026-09-16.md §8).
 * Solo investigación — no modifica código de producción.
 */

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, sembrarMotivosYDestinos, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { registrarVenta } from "../../src/server/actions/movimientos/venta";
import { calcularSaldoTotal } from "../setup/saldo-de-seccion";

describe("Auditoría — Pivote 1: concurrencia, casos 2 y 3", () => {
  let sucursalId: string;
  let seccionId: string;
  let seccionDestinoId: string;
  let unidadKgId: string;
  let insumoId: string;
  let motivoVencidoId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    unidadKgId = catalogo.kg.id;
    insumoId = catalogo.insumo.id;
    seccionId = (await sembrarSeccion(sucursalId, "Depósito")).id;
    seccionDestinoId = (await sembrarSeccion(sucursalId, "Cocina")).id;
    motivoVencidoId = (await sembrarMotivosYDestinos()).motivos.get("Vencido")!;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  function resumen(settled: PromiseSettledResult<Awaited<ReturnType<typeof registrarMovimiento>>>[]) {
    return settled.map((s) => (s.status === "fulfilled" ? { ok: s.value.ok, mensaje: s.value.mensaje } : { rejected: true, name: (s.reason as Error)?.constructor?.name, message: String((s.reason as Error)?.message).slice(0, 150) }));
  }

  describe("Caso 2: dos VENTAS simultáneas que consumen la misma receta (mismo insumo, stock limitado)", () => {
    it("con stock exacto para UNA sola venta, la otra falla limpio (o el Hallazgo 1 se repite acá también) — nunca ambas tienen éxito", async () => {
      const mpInsumo = await sembrarProductoDisponible({ codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, insumoId }, sucursalId);
      const pv = await sembrarProductoDisponible({ codigo: "PV_PAN", nombre: "Pan", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 100 }, sucursalId);
      await prisma.recetaVersion.create({
        data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mpInsumo.id, cantidad: 1, unidadId: unidadKgId }] } },
      });
      // Stock para 1 venta de 6 unidades de pan (6kg de harina), no para 2.
      await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mpInsumo.id, cantidad: 6 }] });

      const settled = await Promise.allSettled([
        registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: pv.id, cantidadVendida: 6 }] }),
        registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: pv.id, cantidadVendida: 6 }] }),
      ]);

      console.log("[auditoria] Caso 2 (ventas concurrentes, misma receta):", resumen(settled as never));

      const exitosas = settled.filter((s) => s.status === "fulfilled" && s.value.ok);
      expect(exitosas.length).toBeLessThanOrEqual(1); // nunca las dos: eso sería vender el doble del stock real

      const saldoFinal = await calcularSaldoTotal(mpInsumo.id, seccionId, prisma);
      expect(saldoFinal).toBeGreaterThanOrEqual(0); // nunca negativo — la invariante que más importa
      if (exitosas.length === 1) expect(saldoFinal).toBe(0); // se vendió exactamente lo que había
    });

    it("REGRESIÓN (Plan C2): con stock suficiente para AMBAS ventas combinadas, las dos deben tener éxito SIEMPRE — nunca un rechazo crudo del driver, 15/15 corridas", async () => {
      // Antes de C2: el Hallazgo 1 se repetía también en registrarVenta
      // (no solo en registrarMovimiento) — 1/6 corridas en la verificación
      // original. Mismo criterio que concurrencia-idempotencia.test.ts:
      // loop dentro del test, no una corrida manual repetida a mano.
      for (let intento = 0; intento < 15; intento++) {
        // Sin insumoId a propósito: si compartiera insumoId con otras
        // iteraciones, resolverConsumoPorFamilia trataría los productos de
        // iteraciones distintas como "hermanos" y podría repartir el
        // consumo entre ellos, contaminando el aislamiento del loop.
        const mpInsumo = await sembrarProductoDisponible({ codigo: `MP_HARINA2_${intento}`, nombre: `Harina2_${intento}`, tipo: "MP", unidadStockId: unidadKgId }, sucursalId);
        const pv = await sembrarProductoDisponible({ codigo: `PV_PAN2_${intento}`, nombre: `Pan2_${intento}`, tipo: "PV", unidadStockId: unidadKgId, precioVenta: 100 }, sucursalId);
        await prisma.recetaVersion.create({
          data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mpInsumo.id, cantidad: 1, unidadId: unidadKgId }] } },
        });
        await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mpInsumo.id, cantidad: 20 }] });

        const settled = await Promise.allSettled([
          registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: pv.id, cantidadVendida: 6 }] }),
          registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: pv.id, cantidadVendida: 6 }] }),
        ]);
        if (settled.some((s) => s.status === "rejected")) console.log(`[auditoria] Intento ${intento} (venta):`, resumen(settled as never));

        expect(settled.every((s) => s.status === "fulfilled" && s.value.ok), `intento ${intento}: ambas ventas deben tener éxito`).toBe(true);
        expect(await calcularSaldoTotal(mpInsumo.id, seccionId, prisma)).toBe(8); // 20 - 6 - 6, siempre
      }
    });
  });

  describe("Caso 3: CONSUMO simultáneo con MERMA / TRANSFERENCIA sobre el mismo producto+sección", () => {
    it("CONSUMO + MERMA simultáneos, stock exacto para uno solo de los dos: el saldo final nunca queda negativo", async () => {
      const mp = await sembrarProductoDisponible({ codigo: "MP_TOMATE", nombre: "Tomate", tipo: "MP", unidadStockId: unidadKgId, insumoId }, sucursalId);
      await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 10 }] });

      const settled = await Promise.allSettled([
        registrarMovimiento({ proceso: "CONSUMO", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 6 }] }),
        registrarMovimiento({ proceso: "MERMA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 6 }], motivoId: motivoVencidoId }),
      ]);
      console.log("[auditoria] Caso 3a (consumo+merma):", resumen(settled as never));

      const saldoFinal = await calcularSaldoTotal(mp.id, seccionId, prisma);
      expect(saldoFinal).toBeGreaterThanOrEqual(0);
      const exitosas = settled.filter((s) => s.status === "fulfilled" && s.value.ok).length;
      expect(exitosas).toBeLessThanOrEqual(1);
    });

    it("CONSUMO + TRANSFERENCIA (salida) simultáneos, stock exacto para uno solo de los dos: el saldo final nunca queda negativo", async () => {
      const mp = await sembrarProductoDisponible({ codigo: "MP_QUESO", nombre: "Queso", tipo: "MP", unidadStockId: unidadKgId, insumoId }, sucursalId);
      await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 10 }] });

      const settled = await Promise.allSettled([
        registrarMovimiento({ proceso: "CONSUMO", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 6 }] }),
        registrarMovimiento({ proceso: "TRANSFERENCIA", fecha: new Date(), seccionId, seccionDestinoId, items: [{ productoId: mp.id, cantidad: 6 }] }),
      ]);
      console.log("[auditoria] Caso 3b (consumo+transferencia):", resumen(settled as never));

      const saldoOrigen = await calcularSaldoTotal(mp.id, seccionId, prisma);
      const saldoDestino = await calcularSaldoTotal(mp.id, seccionDestinoId, prisma);
      expect(saldoOrigen).toBeGreaterThanOrEqual(0);
      const exitosas = settled.filter((s) => s.status === "fulfilled" && s.value.ok).length;
      expect(exitosas).toBeLessThanOrEqual(1);
      // El total del sistema (origen+destino) nunca debe superar lo comprado (10).
      expect(saldoOrigen + saldoDestino).toBeLessThanOrEqual(10);
    });
  });
});
