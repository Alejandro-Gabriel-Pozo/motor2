import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos";
import { registrarVenta } from "../../src/server/actions/venta";
import { obtenerResumenOperativo } from "../../src/core/reportes/resumen-operativo";

describe("obtenerResumenOperativo", () => {
  let sucursalId: string;
  let seccionId: string;
  let unidadKgId: string;
  let insumoId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    unidadKgId = catalogo.kg.id;
    insumoId = catalogo.insumo.id;
    seccionId = (await sembrarSeccion(sucursalId)).id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  it("cuenta combinaciones producto+sección con movimientos, detecta negativos, y trae el financiero del mes actual", async () => {
    const mp = await prisma.producto.create({ data: { codigo: "MP_1", nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, insumoId } });
    const pv = await prisma.producto.create({ data: { codigo: "PV_1", nombre: "Pan", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 100 } });
    await prisma.recetaVersion.create({ data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 1, unidadId: unidadKgId }] } } });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 5, precioTotal: 50 }] });
    await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: pv.id, cantidadVendida: 2 }] });

    const resumen = await obtenerResumenOperativo(sucursalId);
    expect(resumen.stock.totalItems).toBeGreaterThanOrEqual(2); // mp y pv, al menos
    expect(resumen.movimientos.total).toBeGreaterThan(0);
    expect(resumen.financiero.ventasTotal).toBe(200);
    // El PV vendido sin ser "Se produce" queda con saldo negativo (artefacto contable de la venta).
    const filaPv = resumen.topStockBajo.find((s) => s.producto === "Pan");
    expect(filaPv?.saldo).toBe(-2);
  });
});
