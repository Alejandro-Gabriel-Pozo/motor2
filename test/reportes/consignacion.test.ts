import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos";
import { registrarVenta } from "../../src/server/actions/venta";
import { generarReporteConsignacion } from "../../src/core/reportes/consignacion";

describe("generarReporteConsignacion", () => {
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

  it("detecta cuánto se le debe a cada consignante y cuánto stock en consignación queda sin vender", async () => {
    const consignante = await prisma.proveedor.create({ data: { codigo: "PRV_1", nombre: "Vinos del Valle" } });
    const mp = await prisma.producto.create({
      data: {
        codigo: "MP_VINO", nombre: "Vino en consignación", tipo: "MP", unidadStockId: unidadKgId, insumoId,
        esConsignacion: true, proveedorConsignacionId: consignante.id, precioConsignacion: 20,
      },
    });
    const pv = await prisma.producto.create({ data: { codigo: "PV_COPA", nombre: "Copa de vino", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 50 } });
    await prisma.recetaVersion.create({ data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 1, unidadId: unidadKgId }] } } });

    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, proveedorId: consignante.id, items: [{ productoId: mp.id, cantidad: 10 }] }); // recepción sin costo real
    await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: pv.id, cantidadVendida: 3 }] });

    const rep = await generarReporteConsignacion(sucursalId);
    expect(rep.debidoPorConsignante.find((d) => d.proveedor === "Vinos del Valle")?.importe).toBe(3 * 20);
    expect(rep.stockSinVender.find((s) => s.productoId === mp.id)?.stockActual).toBe(7);
  });
});
