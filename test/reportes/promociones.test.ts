import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { registrarVenta } from "../../src/server/actions/movimientos/venta";
import { actualizarPromocionesHabilitado, marcarProductoComoPromocion } from "../../src/server/actions/reportes/promociones";
import { obtenerReportePromociones } from "../../src/core/reportes/promociones";
import { obtenerReportePorPeriodo } from "../../src/core/reportes/periodo";

describe("Promociones y Combos", () => {
  let sucursalId: string;
  let seccionId: string;
  let unidadKgId: string;
  let insumoId: string;
  let adminId: string;
  let operadorId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    unidadKgId = catalogo.kg.id;
    insumoId = catalogo.insumo.id;
    seccionId = (await sembrarSeccion(sucursalId)).id;

    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    const operador = await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId, rolId: base.operador.id });
    adminId = admin.id;
    operadorId = operador.id;
  });

  it("apagada por defecto: el reporte devuelve habilitado=false sin calcular nada", async () => {
    const rep = await obtenerReportePromociones(sucursalId, new Date(0), new Date());
    expect(rep.habilitado).toBe(false);
  });

  it("actualizarPromocionesHabilitado requiere admin", async () => {
    await mockearUsuarioActual({ id: operadorId, email: "operador@test.com", nombre: null });
    const resultado = await actualizarPromocionesHabilitado(true);
    expect(resultado.ok).toBe(false);

    await mockearUsuarioActual({ id: adminId, email: "admin@test.com", nombre: null });
    const resultadoAdmin = await actualizarPromocionesHabilitado(true);
    expect(resultadoAdmin.ok).toBe(true);
    expect((await prisma.sucursal.findUniqueOrThrow({ where: { id: sucursalId } })).promocionesHabilitadas).toBe(true);
  });

  it("marcarProductoComoPromocion requiere admin", async () => {
    const pv = await sembrarProductoDisponible({ codigo: "PV_1", nombre: "Menú ejecutivo", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 100 }, sucursalId);

    await mockearUsuarioActual({ id: operadorId, email: "operador@test.com", nombre: null });
    const resultado = await marcarProductoComoPromocion(pv.id, true);
    expect(resultado.ok).toBe(false);
  });

  it("separa facturación de Promoción/Combo vs a la carta, y calcula el valor a la carta con el precio de venta individual de cada insumo", async () => {
    await mockearUsuarioActual({ id: adminId, email: "admin@test.com", nombre: null });
    await actualizarPromocionesHabilitado(true);

    const mp = await sembrarProductoDisponible({ codigo: "MP_1", nombre: "Carne", tipo: "MP", unidadStockId: unidadKgId, insumoId, precioVenta: 30 }, sucursalId); // se vende suelta a $30/kg
    const combo = await sembrarProductoDisponible({ codigo: "PV_COMBO", nombre: "Menú ejecutivo", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 50 }, sucursalId);
    const aLaCarta = await sembrarProductoDisponible({ codigo: "PV_CARTA", nombre: "Ensalada", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 40 }, sucursalId);
    await prisma.recetaVersion.create({ data: { productoId: combo.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 2, unidadId: unidadKgId }] } } });
    await marcarProductoComoPromocion(combo.id, true);

    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 100 }] });
    await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: combo.id, cantidadVendida: 1 }, { productoId: aLaCarta.id, cantidadVendida: 1 }] });

    const hoy = new Date();
    const desde = new Date(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1);
    const rep = await obtenerReportePromociones(sucursalId, desde, hoy);
    if (!rep.habilitado) throw new Error("esperaba habilitado=true");

    expect(rep.totalFacturadoPromociones).toBe(50);
    expect(rep.totalFacturadoALaCarta).toBe(40);
    const filaCombo = rep.promociones[0];
    expect(filaCombo.valorALaCartaUnitario).toBe(2 * 30); // 2kg de carne × $30/kg sueltos
    expect(filaCombo.descuentoUnitario).toBeCloseTo(60 - 50);
    expect(filaCombo.incompleto).toBe(false);
  });

  it("el margen Real coincide exactamente con el de Período para el mismo producto y rango (fuente única, no dos cálculos)", async () => {
    await mockearUsuarioActual({ id: adminId, email: "admin@test.com", nombre: null });
    await actualizarPromocionesHabilitado(true);

    const mp = await sembrarProductoDisponible({ codigo: "MP_QUESO", nombre: "Queso", tipo: "MP", unidadStockId: unidadKgId, insumoId }, sucursalId);
    const combo = await sembrarProductoDisponible({ codigo: "PV_COMBO_R", nombre: "Combo real", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 100 }, sucursalId);
    await prisma.recetaVersion.create({ data: { productoId: combo.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 1, unidadId: unidadKgId }] } } });
    await marcarProductoComoPromocion(combo.id, true);

    const hoy = new Date();
    await registrarMovimiento({ proceso: "COMPRA", fecha: hoy, seccionId, items: [{ productoId: mp.id, cantidad: 10, precioTotal: 40 }] }); // $4/kg
    await registrarVenta({ fecha: hoy, seccionId, ventas: [{ productoId: combo.id, cantidadVendida: 1 }] });
    // Como si no se hubiera guardado el costo al vender: se reconstruye con el historial de compras.
    await prisma.movimientoStock.updateMany({ where: { productoId: combo.id, operacion: { proceso: "VENTA" } }, data: { costoUnitarioVenta: null } });

    const desde = new Date(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1);
    const [repPeriodo, repPromociones] = await Promise.all([
      obtenerReportePorPeriodo(sucursalId, desde, hoy),
      obtenerReportePromociones(sucursalId, desde, hoy),
    ]);
    if (!repPromociones.habilitado) throw new Error("esperaba habilitado=true");

    const filaPeriodo = repPeriodo.margen.porProducto.find((f) => f.productoId === combo.id)!;
    const filaPromo = repPromociones.promociones.find((f) => f.producto === "Combo real")!;

    expect(filaPeriodo.margenReal).not.toBeNull();
    expect(filaPromo.margenReal).toBe(filaPeriodo.margenReal);
    expect(filaPromo.margenRealPct).toBe(filaPeriodo.margenRealPct);
    expect(filaPromo.margenRealReconstruido).toBe(true);
    expect(filaPromo.margenRealCompleto).toBe(filaPeriodo.margenRealCompleto);
  });
});
