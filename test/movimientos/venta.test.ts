import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { registrarVenta, anularVenta } from "../../src/server/actions/movimientos/venta";
import { setPrecioLocalProducto } from "../../src/server/actions/movimientos/precio-local";
import { calcularSaldoTotal } from "../../src/core/movimientos/stock";

describe("registrarVenta", () => {
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

  it("rechaza vender un producto que no es PV (sesión 'eliminar COMPRA+VENTA': ya no existe la venta directa de una MP)", async () => {
    const mp = await prisma.producto.create({ data: { codigo: "MP_1", nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, insumoId } });
    const resultado = await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: mp.id, cantidadVendida: 1 }] });
    expect(resultado.ok).toBe(false);
  });

  it("vender un PV con receta consume la MP correspondiente, sin descontar stock del propio PV", async () => {
    const mp = await prisma.producto.create({ data: { codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, insumoId } });
    const pv = await prisma.producto.create({ data: { codigo: "PV_PAN", nombre: "Pan", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 100 } });
    await prisma.recetaVersion.create({
      data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 0.2, unidadId: unidadKgId, mermaPorcentaje: 0 }] } },
    });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 10 }] });

    const resultado = await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: pv.id, cantidadVendida: 3 }] });
    expect(resultado.ok).toBe(true);

    expect(await calcularSaldoTotal(mp.id, seccionId)).toBeCloseTo(10 - 3 * 0.2);
    // El PV no "Se produce": su saldo negativo es un artefacto contable de las ventas, no inventario real.
    expect(await calcularSaldoTotal(pv.id, seccionId)).toBe(-3);
  });

  it("un PV \"Se produce\" no vuelve a consumir su receta al venderse (ya se consumió al producir)", async () => {
    const mp = await prisma.producto.create({ data: { codigo: "MP_CARNE", nombre: "Carne", tipo: "MP", unidadStockId: unidadKgId, insumoId } });
    const pv = await prisma.producto.create({ data: { codigo: "PV_EMPANADA", nombre: "Empanada", tipo: "PV", unidadStockId: unidadKgId, seProduce: true, precioVenta: 50 } });
    await prisma.recetaVersion.create({
      data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 1, unidadId: unidadKgId, mermaPorcentaje: 0 }] } },
    });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 20 }] });
    const produccion = await registrarMovimiento({ proceso: "PRODUCCION", fecha: new Date(), seccionId, items: [{ productoId: pv.id, cantidad: 5 }] });
    expect(produccion.ok).toBe(true);

    const saldoMpTrasProducir = await calcularSaldoTotal(mp.id, seccionId);
    expect(saldoMpTrasProducir).toBe(15); // 20 compradas - 5 consumidas al producir
    const resultado = await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: pv.id, cantidadVendida: 2 }] });
    expect(resultado.ok).toBe(true);

    expect(await calcularSaldoTotal(mp.id, seccionId)).toBe(saldoMpTrasProducir); // sin cambios: la receta no se vuelve a consumir
    expect(await calcularSaldoTotal(pv.id, seccionId)).toBe(3); // 5 producidas - 2 vendidas
  });

  it("vender una MP en consignación (vía receta) genera Consumo + Liquidación con importe según precioConsignacion", async () => {
    const proveedor = await prisma.proveedor.create({ data: { codigo: "PRV_C", nombre: "Consignante" } });
    const mp = await prisma.producto.create({
      data: { codigo: "MP_VINO", nombre: "Vino en consignación", tipo: "MP", unidadStockId: unidadKgId, insumoId, esConsignacion: true, proveedorConsignacionId: proveedor.id, precioConsignacion: 30 },
    });
    const pv = await prisma.producto.create({ data: { codigo: "PV_COPA", nombre: "Copa de vino", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 80 } });
    await prisma.recetaVersion.create({
      data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 0.15, unidadId: unidadKgId, mermaPorcentaje: 0 }] } },
    });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 10 }] });

    const resultado = await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: pv.id, cantidadVendida: 1 }] });
    expect(resultado.ok).toBe(true);

    const liquidacion = await prisma.movimientoStock.findFirst({ where: { productoId: mp.id, proceso: "LIQUIDACION_CONSIGNACION" } });
    expect(liquidacion).not.toBeNull();
    expect(Number(liquidacion!.cantidad)).toBe(0);
    expect(Number(liquidacion!.precioTotal)).toBeCloseTo(0.15 * 30);
  });

  it("Precio Local habilitado pisa el precio global; deshabilitado usa el global", async () => {
    const pv = await prisma.producto.create({ data: { codigo: "PV_GASEOSA", nombre: "Gaseosa", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 100 } });

    await setPrecioLocalProducto(pv.id, 120, true);
    await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: pv.id, cantidadVendida: 1 }] });
    let venta = await prisma.movimientoStock.findFirst({ where: { productoId: pv.id, proceso: "VENTA" }, orderBy: { creadoEn: "desc" } });
    expect(Number(venta!.precioTotal)).toBe(120);

    await setPrecioLocalProducto(pv.id, 120, false);
    await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: pv.id, cantidadVendida: 1 }] });
    venta = await prisma.movimientoStock.findFirst({ where: { productoId: pv.id, proceso: "VENTA" }, orderBy: { creadoEn: "desc" } });
    expect(Number(venta!.precioTotal)).toBe(100);
  });

  it("rechaza la venta si no alcanza el stock de la MP consumida por receta", async () => {
    const mp = await prisma.producto.create({ data: { codigo: "MP_ESCASA", nombre: "Trufa", tipo: "MP", unidadStockId: unidadKgId, insumoId } });
    const pv = await prisma.producto.create({ data: { codigo: "PV_RISOTTO", nombre: "Risotto", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 500 } });
    await prisma.recetaVersion.create({
      data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 1, unidadId: unidadKgId, mermaPorcentaje: 0 }] } },
    });
    // sin ninguna Compra: saldo de la MP es 0

    const resultado = await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: pv.id, cantidadVendida: 1 }] });
    expect(resultado.ok).toBe(false);
  });
});

describe("anularVenta", () => {
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

  it("revierte el consumo de la MP y el saldo del PV, y marca la venta como anulada", async () => {
    const mp = await prisma.producto.create({ data: { codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, insumoId } });
    const pv = await prisma.producto.create({ data: { codigo: "PV_PAN", nombre: "Pan", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 100 } });
    await prisma.recetaVersion.create({
      data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 0.2, unidadId: unidadKgId, mermaPorcentaje: 0 }] } },
    });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 10 }] });
    await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: pv.id, cantidadVendida: 3 }] });
    const saldoMpTrasVender = await calcularSaldoTotal(mp.id, seccionId);
    expect(saldoMpTrasVender).toBeCloseTo(10 - 3 * 0.2);

    const operacionVenta = await prisma.operacion.findFirstOrThrow({ where: { proceso: "VENTA", sucursalId } });
    const resultado = await anularVenta(operacionVenta.id);
    expect(resultado.ok, resultado.mensaje).toBe(true);

    expect(await calcularSaldoTotal(mp.id, seccionId)).toBeCloseTo(10); // el consumo se revirtió del todo
    expect(await calcularSaldoTotal(pv.id, seccionId)).toBe(0); // la línea VENTA (artefacto contable) también se revirtió

    const venta = await prisma.operacion.findUniqueOrThrow({ where: { id: operacionVenta.id } });
    expect(venta.anuladaEn).not.toBeNull();
  });

  it("revierte también la Liquidación de consignación, neteando el importe a 0", async () => {
    const proveedor = await prisma.proveedor.create({ data: { codigo: "PRV_C", nombre: "Consignante" } });
    const mp = await prisma.producto.create({
      data: { codigo: "MP_VINO", nombre: "Vino en consignación", tipo: "MP", unidadStockId: unidadKgId, insumoId, esConsignacion: true, proveedorConsignacionId: proveedor.id, precioConsignacion: 30 },
    });
    const pv = await prisma.producto.create({ data: { codigo: "PV_COPA", nombre: "Copa de vino", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 80 } });
    await prisma.recetaVersion.create({
      data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 0.15, unidadId: unidadKgId, mermaPorcentaje: 0 }] } },
    });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 10 }] });
    await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: pv.id, cantidadVendida: 1 }] });

    const operacionVenta = await prisma.operacion.findFirstOrThrow({ where: { proceso: "VENTA", sucursalId } });
    const resultado = await anularVenta(operacionVenta.id);
    expect(resultado.ok, resultado.mensaje).toBe(true);

    const liquidaciones = await prisma.movimientoStock.findMany({ where: { productoId: mp.id, proceso: "LIQUIDACION_CONSIGNACION" } });
    expect(liquidaciones).toHaveLength(2); // la original + la reversión
    const totalNeto = liquidaciones.reduce((acc, l) => acc + Number(l.precioTotal), 0);
    expect(totalNeto).toBeCloseTo(0);
  });

  it("rechaza anular la misma venta dos veces", async () => {
    const mp = await prisma.producto.create({ data: { codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, insumoId } });
    const pv = await prisma.producto.create({ data: { codigo: "PV_PAN", nombre: "Pan", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 100 } });
    await prisma.recetaVersion.create({
      data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 0.2, unidadId: unidadKgId, mermaPorcentaje: 0 }] } },
    });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 10 }] });
    await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: pv.id, cantidadVendida: 1 }] });
    const operacionVenta = await prisma.operacion.findFirstOrThrow({ where: { proceso: "VENTA", sucursalId } });

    expect((await anularVenta(operacionVenta.id)).ok).toBe(true);
    const segundoIntento = await anularVenta(operacionVenta.id);
    expect(segundoIntento.ok).toBe(false);
  });

  it("rechaza anular una Operacion que no es Venta", async () => {
    const mp = await prisma.producto.create({ data: { codigo: "MP_SAL", nombre: "Sal", tipo: "MP", unidadStockId: unidadKgId, insumoId } });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 10 }] });
    const operacionCompra = await prisma.operacion.findFirstOrThrow({ where: { proceso: "COMPRA", sucursalId } });

    const resultado = await anularVenta(operacionCompra.id);
    expect(resultado.ok).toBe(false);
  });

  it("nunca anula una venta de otra sucursal, aunque el ID exista de verdad", async () => {
    const otraSucursal = await prisma.sucursal.create({ data: { nombre: "Sucursal B" } });
    const otraSeccion = await sembrarSeccion(otraSucursal.id, "Depósito B");
    const mp = await prisma.producto.create({ data: { codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, insumoId } });
    const admin = await prisma.user.findFirstOrThrow({ where: { email: "admin@test.com" } });

    // Venta real en la OTRA sucursal — armada directo por Prisma (no hay
    // sesión de admin ahí) para no depender de un segundo login en el test.
    const operacionOtraSucursal = await prisma.operacion.create({
      data: { sucursalId: otraSucursal.id, proceso: "VENTA", fecha: new Date(), usuarioId: admin.id },
    });
    await prisma.movimientoStock.create({
      data: { operacionId: operacionOtraSucursal.id, productoId: mp.id, seccionId: otraSeccion.id, proceso: "VENTA", cantidad: -1, detalle: "Venta", precioTotal: 100, precioPorUnidadStock: 100 },
    });

    const resultado = await anularVenta(operacionOtraSucursal.id);
    expect(resultado.ok).toBe(false);

    const sigueVigente = await prisma.operacion.findUniqueOrThrow({ where: { id: operacionOtraSucursal.id } });
    expect(sigueVigente.anuladaEn).toBeNull();
  });
});
