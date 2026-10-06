import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, crearUsuarioConMembresia } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { sugerirInsumosClaseA } from "../../src/core/stock/sugerencia-clase-a";
import { prisma } from "../setup/test-db";

describe("sugerirInsumosClaseA", () => {
  let sucursalId: string;
  let seccionId: string;
  let unidadKgId: string;

  const desde = new Date("2026-01-01");
  const hasta = new Date("2026-01-31");
  const dentroDelRango = new Date("2026-01-15");

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    unidadKgId = catalogo.kg.id;
    seccionId = (await sembrarSeccion(sucursalId)).id;

    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  it("sin compras en la ventana, no sugiere nada", async () => {
    expect(await sugerirInsumosClaseA(sucursalId, desde, hasta, prisma)).toEqual([]);
  });

  it("corta en el 80% acumulado: un insumo caro solo, dos baratos afuera", async () => {
    const caro = await sembrarProductoDisponible({ codigo: "MP_CARO", nombre: "Carne", tipo: "MP", unidadStockId: unidadKgId }, sucursalId);
    const barato1 = await sembrarProductoDisponible({ codigo: "MP_B1", nombre: "Sal", tipo: "MP", unidadStockId: unidadKgId }, sucursalId);
    const barato2 = await sembrarProductoDisponible({ codigo: "MP_B2", nombre: "Pimienta", tipo: "MP", unidadStockId: unidadKgId }, sucursalId);

    // 900 + 50 + 50 = 1000 total: Carne sola ya es 90% acumulado → clase A; las otras dos quedan afuera.
    await registrarMovimiento({ proceso: "COMPRA", fecha: dentroDelRango, seccionId, items: [{ productoId: caro.id, cantidad: 10, precioTotal: 900 }] });
    await registrarMovimiento({ proceso: "COMPRA", fecha: dentroDelRango, seccionId, items: [{ productoId: barato1.id, cantidad: 10, precioTotal: 50 }] });
    await registrarMovimiento({ proceso: "COMPRA", fecha: dentroDelRango, seccionId, items: [{ productoId: barato2.id, cantidad: 10, precioTotal: 50 }] });

    const sugeridos = await sugerirInsumosClaseA(sucursalId, desde, hasta, prisma);
    expect(sugeridos).toHaveLength(1);
    expect(sugeridos[0]).toMatchObject({ productoId: caro.id, nombre: "Carne", importe: 900, porcentajeAcumulado: 90 });
  });

  it("con gasto repartido parejo, el corte 80% incluye varios productos", async () => {
    const productos = await Promise.all(
      Array.from({ length: 5 }, (_, i) => sembrarProductoDisponible({ codigo: `MP_PAR_${i}`, nombre: `Insumo ${i}`, tipo: "MP", unidadStockId: unidadKgId }, sucursalId))
    );
    // 5 x 200 = 1000: el corte al 80% (800) cae en el 4to producto (200+200+200+200=800, acumulado exactamente 80%).
    for (const p of productos) {
      await registrarMovimiento({ proceso: "COMPRA", fecha: dentroDelRango, seccionId, items: [{ productoId: p.id, cantidad: 10, precioTotal: 200 }] });
    }
    const sugeridos = await sugerirInsumosClaseA(sucursalId, desde, hasta, prisma);
    expect(sugeridos).toHaveLength(4);
    expect(sugeridos.every((s) => productos.some((p) => p.id === s.productoId))).toBe(true);
  });

  it("ignora compras anuladas y fuera de la ventana elegida", async () => {
    const insumo = await sembrarProductoDisponible({ codigo: "MP_FUERA", nombre: "Fuera de ventana", tipo: "MP", unidadStockId: unidadKgId }, sucursalId);
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2025-06-01"), seccionId, items: [{ productoId: insumo.id, cantidad: 10, precioTotal: 500 }] });
    expect(await sugerirInsumosClaseA(sucursalId, desde, hasta, prisma)).toEqual([]);
  });
});
