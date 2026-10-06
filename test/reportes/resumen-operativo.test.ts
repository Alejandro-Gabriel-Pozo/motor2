import { beforeEach, describe, expect, it, vi } from "vitest";
import { AHORA_DE_LA_CORRIDA } from "../setup/tiempo";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { registrarVenta } from "../../src/server/actions/movimientos/venta";
import { obtenerResumenOperativo } from "../../src/server/consultas/reportes/resumen-operativo";

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

  it("cuenta combinaciones producto+sección con movimientos, detecta negativos, y trae el financiero de los últimos 30 días (default)", async () => {
    const mp = await sembrarProductoDisponible({ codigo: "MP_1", nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, insumoId }, sucursalId);
    const pv = await sembrarProductoDisponible({ codigo: "PV_1", nombre: "Pan", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 100 }, sucursalId);
    await prisma.recetaVersion.create({ data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 1, unidadId: unidadKgId }] } } });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 5, precioTotal: 50 }] });
    await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: pv.id, cantidadVendida: 2 }] });

    const resumen = await obtenerResumenOperativo(sucursalId, prisma, AHORA_DE_LA_CORRIDA);
    expect(resumen.stock.totalItems).toBeGreaterThanOrEqual(2); // mp y pv, al menos
    expect(resumen.movimientos.total).toBeGreaterThan(0);
    expect(resumen.financiero.ventasTotal).toBe(200);
    // El PV vendido sin ser "Se produce" queda con saldo negativo (artefacto contable de la venta).
    const filaPv = resumen.topStockBajo.find((s) => s.producto === "Pan");
    expect(filaPv?.saldo).toBe(-2);
  });

  it("con un rango explícito que no incluye la venta, el financiero no la cuenta (el default de 30 días no es el único rango posible)", async () => {
    const mp = await sembrarProductoDisponible({ codigo: "MP_2", nombre: "Harina 2", tipo: "MP", unidadStockId: unidadKgId, insumoId }, sucursalId);
    const pv = await sembrarProductoDisponible({ codigo: "PV_2", nombre: "Pan 2", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 100 }, sucursalId);
    await prisma.recetaVersion.create({ data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 1, unidadId: unidadKgId }] } } });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 5, precioTotal: 50 }] });
    await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: pv.id, cantidadVendida: 2 }] });

    const haceUnAño = new Date();
    haceUnAño.setUTCFullYear(haceUnAño.getUTCFullYear() - 1);
    const resumen = await obtenerResumenOperativo(sucursalId, prisma, AHORA_DE_LA_CORRIDA, { desde: haceUnAño, hasta: haceUnAño });
    expect(resumen.financiero.ventasTotal).toBe(0);
    // El stock/movimientos no dependen del rango del financiero: siguen viendo el libro mayor completo.
    expect(resumen.movimientos.total).toBeGreaterThan(0);
  });
});
