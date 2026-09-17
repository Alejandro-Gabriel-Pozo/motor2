import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { registrarVenta } from "../../src/server/actions/movimientos/venta";
import { generarReportePerdidas } from "../../src/core/reportes/perdidas";

describe("generarReportePerdidas", () => {
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

  it("una fila por evento (no agrupado), con fecha y producto, valorizada con el costo de reposición", async () => {
    const mp = await prisma.producto.create({ data: { codigo: "MP_1", nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, insumoId } });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 10, precioTotal: 100 }] }); // $10/kg
    await registrarMovimiento({ proceso: "MERMA", fecha: new Date(), seccionId, motivo: "VENCIDO", items: [{ productoId: mp.id, cantidad: 2 }] });
    await registrarMovimiento({ proceso: "MERMA", fecha: new Date(), seccionId, motivo: "ROTO_O_CAIDO", items: [{ productoId: mp.id, cantidad: 1 }] });

    const rep = await generarReportePerdidas(sucursalId, 30);
    expect(rep.mermas).toHaveLength(2);
    const vencido = rep.mermas.find((m) => m.motivo === "VENCIDO")!;
    expect(vencido.valor).toBe(20);
    expect(vencido.producto).toBe("Harina");
    expect(vencido.fecha).toBeInstanceOf(Date);
    expect(vencido.idOperacion).toBeTruthy();
    expect(rep.mermas.find((m) => m.motivo === "ROTO_O_CAIDO")?.valor).toBe(10);
    expect(rep.totalMerma).toBe(30);
  });

  it("no inventa el costo cuando no hay compra registrada: marca sinPrecio y no suma al total", async () => {
    const mp = await prisma.producto.create({ data: { codigo: "MP_1", nombre: "Sin compra", tipo: "MP", unidadStockId: unidadKgId, insumoId } });
    await registrarMovimiento({ proceso: "AJUSTE", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 5 }] }); // stock sin costo de compra
    await registrarMovimiento({ proceso: "MERMA", fecha: new Date(), seccionId, motivo: "OTRO", items: [{ productoId: mp.id, cantidad: 2 }] });

    const rep = await generarReportePerdidas(sucursalId, 30);
    const fila = rep.mermas.find((m) => m.motivo === "OTRO")!;
    expect(fila.sinPrecio).toBe(true);
    expect(fila.valor).toBe(0);
    expect(rep.hayCostoIncompleto).toBe(true);
  });

  it("consumo manual queda con su destino tipado; el consumo automático por receta (Venta) cae en su propia fila, cada venta la suya", async () => {
    const mp = await prisma.producto.create({ data: { codigo: "MP_1", nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, insumoId } });
    const pv = await prisma.producto.create({ data: { codigo: "PV_1", nombre: "Pan", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 100 } });
    await prisma.recetaVersion.create({ data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 1, unidadId: unidadKgId }] } } });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 20, precioTotal: 200 }] }); // $10/kg

    await registrarMovimiento({ proceso: "CONSUMO", fecha: new Date(), seccionId, destino: "DEGUSTACION_CORTESIA", items: [{ productoId: mp.id, cantidad: 3 }] });
    await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: pv.id, cantidadVendida: 2 }] }); // genera Consumo automático de la receta

    const rep = await generarReportePerdidas(sucursalId, 30);
    expect(rep.consumos.find((c) => c.motivo === "DEGUSTACION_CORTESIA")?.cantidad).toBe(3);
    expect(rep.consumos.find((c) => c.motivo === "(automático por receta)")?.cantidad).toBe(2);
  });
});
