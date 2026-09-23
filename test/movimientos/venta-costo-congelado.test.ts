import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { registrarVenta } from "../../src/server/actions/movimientos/venta";
import { obtenerReportePorPeriodo } from "../../src/core/reportes/periodo";

/**
 * «Margen real» = el costo que quedó CONGELADO en cada venta al registrarla (MovimientoStock.costoUnitarioVenta). Una venta
 * registrada desde la aplicación tiene que dejarlo guardado, y el reporte por período lo usa; las ventas que se cargaron sin él
 * (por ejemplo, los datos de la demo) no cuentan y por eso «Real» dice «sin datos todavía».
 */
describe("Margen real: el costo congelado al vender", () => {
  let sucursalId: string;
  let seccionId: string;
  let pvId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const { kg } = await sembrarCatalogoBase();
    seccionId = (await sembrarSeccion(sucursalId, "Depósito")).id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });

    const harina = await sembrarProductoDisponible({ codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: kg.id }, sucursalId);
    const pan = await sembrarProductoDisponible({ codigo: "PV_PAN", nombre: "Pan", tipo: "PV", unidadStockId: kg.id, precioVenta: 100 }, sucursalId);
    await prisma.recetaVersion.create({ data: { productoId: pan.id, version: 1, ingredientes: { create: [{ insumoProductoId: harina.id, cantidad: 2, unidadId: kg.id }] } } });
    pvId = pan.id;
    // Se compran 10 kg por $50: $5 el kilo; el pan lleva 2 kg → cuesta $10.
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: harina.id, cantidad: 10, precioTotal: 50 }] });
  });

  it("una venta registrada desde la aplicación guarda el costo de la receta en ese momento", async () => {
    const r = await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: pvId, cantidadVendida: 3 }] });
    expect(r.ok, r.mensaje).toBe(true);

    const linea = await prisma.movimientoStock.findFirstOrThrow({ where: { productoId: pvId, operacion: { proceso: "VENTA" } } });
    expect(Number(linea.costoUnitarioVenta)).toBe(10);
  });

  it("el reporte por período la cuenta en «Real»; una venta que no guardó el costo se reconstruye con el historial de compras", async () => {
    await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: pvId, cantidadVendida: 3 }] });
    // Una venta «cargada sin el dato» (como las de la demo): se le borra el costo congelado a una segunda venta.
    await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: pvId, cantidadVendida: 1 }] });
    const sinDato = await prisma.movimientoStock.findMany({ where: { productoId: pvId, operacion: { proceso: "VENTA" } }, orderBy: { creadoEn: "desc" }, take: 1 });
    await prisma.movimientoStock.update({ where: { id: sinDato[0].id }, data: { costoUnitarioVenta: null } });

    const hoy = new Date();
    const rep = await obtenerReportePorPeriodo(sucursalId, new Date(hoy.getTime() - 86_400_000), new Date(hoy.getTime() + 86_400_000));

    // 3 panes con costo guardado ($10) + 1 pan reconstruido con la compra de hoy ($5/kg x 2 kg = $10).
    expect(rep.margen.margenRealTotal).toBe(400 - 40);
    expect(rep.margen.ingresoConCostoReal).toBe(400);
    expect(rep.margen.ingresoRealReconstruido).toBe(100);
    expect(rep.margen.ingresoSinCostoReal).toBe(0);
    expect(rep.margen.avisoReal).toContain("RECONSTRUIDO");
  });
});
