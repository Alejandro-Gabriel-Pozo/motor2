import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { registrarVenta } from "../../src/server/actions/movimientos/venta";
import { actualizarPromocionesHabilitado, marcarProductoComoPromocion } from "../../src/server/actions/reportes/promociones";
import { obtenerReportePromociones } from "../../src/core/reportes/promociones";

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
    const pv = await prisma.producto.create({ data: { codigo: "PV_1", nombre: "Menú ejecutivo", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 100 } });

    await mockearUsuarioActual({ id: operadorId, email: "operador@test.com", nombre: null });
    const resultado = await marcarProductoComoPromocion(pv.id, true);
    expect(resultado.ok).toBe(false);
  });

  it("separa facturación de Promoción/Combo vs a la carta, y calcula el valor a la carta con el precio de venta individual de cada insumo", async () => {
    await mockearUsuarioActual({ id: adminId, email: "admin@test.com", nombre: null });
    await actualizarPromocionesHabilitado(true);

    const mp = await prisma.producto.create({ data: { codigo: "MP_1", nombre: "Carne", tipo: "MP", unidadStockId: unidadKgId, insumoId, precioVenta: 30 } }); // se vende suelta a $30/kg
    const combo = await prisma.producto.create({ data: { codigo: "PV_COMBO", nombre: "Menú ejecutivo", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 50 } });
    const aLaCarta = await prisma.producto.create({ data: { codigo: "PV_CARTA", nombre: "Ensalada", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 40 } });
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
});
