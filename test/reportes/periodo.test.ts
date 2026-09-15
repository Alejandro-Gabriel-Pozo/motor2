import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos";
import { registrarVenta } from "../../src/server/actions/venta";
import { obtenerReportePorPeriodo, generarReporteVentasPorCategoria } from "../../src/core/reportes/periodo";

describe("obtenerReportePorPeriodo", () => {
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

  it("no se corre un día por timezone: un rango 1-al-5 incluye el 1 y el 5 completos", async () => {
    const mp = await prisma.producto.create({ data: { codigo: "MP_1", nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, insumoId } });
    // Fecha límite: primer día del rango, a la mañana temprano en UTC — el
    // bug que se está evitando (Reportes.js:41-48) haría que esto caiga
    // afuera si el límite se calculara con setHours() en vez de setUTCHours().
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-08-01T02:00:00.000Z"), seccionId, items: [{ productoId: mp.id, cantidad: 5, precioTotal: 100 }] });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-08-05T23:00:00.000Z"), seccionId, items: [{ productoId: mp.id, cantidad: 3, precioTotal: 60 }] });
    // Afuera del rango: 31 de julio.
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-07-31T20:00:00.000Z"), seccionId, items: [{ productoId: mp.id, cantidad: 99, precioTotal: 1 }] });

    const rep = await obtenerReportePorPeriodo(sucursalId, new Date("2026-08-01"), new Date("2026-08-05"));
    expect(rep.total).toBe(2);
    expect(rep.compras.totalGastado).toBe(160);
  });

  it("ventas con Precio Total real se toman tal cual; sin precio se estiman al precio de venta vigente y se marcan 'estimado'", async () => {
    const mp = await prisma.producto.create({ data: { codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, insumoId } });
    const pv = await prisma.producto.create({ data: { codigo: "PV_PAN", nombre: "Pan", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 100 } });
    await prisma.recetaVersion.create({ data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 1, unidadId: unidadKgId }] } } });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 100 }] });

    // Venta real (registrarVenta guarda Precio Total real).
    const hoy = new Date();
    await registrarVenta({ fecha: hoy, seccionId, ventas: [{ productoId: pv.id, cantidadVendida: 2 }] });
    // Venta "vieja" sin precio: se inserta directo (registrarVenta siempre guarda el precio real).
    const operacionVieja = await prisma.operacion.create({ data: { sucursalId, proceso: "VENTA", fecha: hoy, usuarioId: (await prisma.user.findFirstOrThrow()).id } });
    await prisma.movimientoStock.create({
      data: { operacionId: operacionVieja.id, productoId: pv.id, seccionId, proceso: "VENTA", cantidad: -1, detalle: "Venta vieja sin precio.", precioTotal: 0, precioPorUnidadStock: 0 },
    });

    const desde = new Date(hoy); desde.setDate(desde.getDate() - 1);
    const hasta = new Date(hoy); hasta.setDate(hasta.getDate() + 1);
    const rep = await obtenerReportePorPeriodo(sucursalId, desde, hasta);

    expect(rep.ventas.totalFacturado).toBe(2 * 100 + 1 * 100); // real (2×100) + estimado (1×precioVenta vigente)
    const fila = rep.ventas.porProducto.find((v) => v.productoId === pv.id)!;
    expect(fila.estimado).toBe(true);
    expect(fila.cantidad).toBe(3);
  });

  it("compras agrupa por proveedor y suma importe; avisa si alguna se cargó sin precio", async () => {
    const mp = await prisma.producto.create({ data: { codigo: "MP_1", nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, insumoId } });
    const proveedor = await prisma.proveedor.create({ data: { codigo: "PRV_1", nombre: "Molino SA" } });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, proveedorId: proveedor.id, items: [{ productoId: mp.id, cantidad: 10, precioTotal: 500 }] });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, proveedorId: proveedor.id, items: [{ productoId: mp.id, cantidad: 5 }] }); // sin precio

    const rep = await obtenerReportePorPeriodo(sucursalId, new Date(Date.now() - 86400000), new Date(Date.now() + 86400000));
    expect(rep.compras.totalGastado).toBe(500);
    expect(rep.compras.hayComprasSinPrecio).toBe(true);
    expect(rep.compras.porProveedor[0].proveedor).toBe("Molino SA");
    expect(rep.compras.porProveedor[0].lineas).toBe(2);
  });

  it("margen del período cruza ventas contra el costo actual de la receta, marcando costoIncompleto cuando falta un precio de insumo", async () => {
    const mp = await prisma.producto.create({ data: { codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, insumoId } });
    const pv = await prisma.producto.create({ data: { codigo: "PV_PAN", nombre: "Pan", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 100 } });
    await prisma.recetaVersion.create({ data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 1, unidadId: unidadKgId }] } } });
    // Stock disponible vía Ajuste (no deja costo de reposición conocido, a diferencia de una Compra) para que la venta pueda concretarse igual.
    await registrarMovimiento({ proceso: "AJUSTE", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 10 }] });
    await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: pv.id, cantidadVendida: 1 }] });

    const rep = await obtenerReportePorPeriodo(sucursalId, new Date(Date.now() - 86400000), new Date(Date.now() + 86400000));
    expect(rep.margen.hayCostoIncompleto).toBe(true);
    expect(rep.margen.porProducto[0].costoIncompleto).toBe(true);
    expect(rep.margen.porProducto[0].margen).toBeNull();
  });
});

describe("generarReporteVentasPorCategoria", () => {
  let sucursalId: string;
  let seccionId: string;
  let unidadKgId: string;

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

  it("agrupa la facturación por Categoría y detecta PV activos sin categoría asignada", async () => {
    const categoria = await prisma.categoriaProducto.create({ data: { nombre: "Panadería" } });
    const pvConCategoria = await prisma.producto.create({ data: { codigo: "PV_1", nombre: "Pan", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 50, categoriaId: categoria.id } });
    const pvSinCategoria = await prisma.producto.create({ data: { codigo: "PV_2", nombre: "Torta", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 80 } });
    await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: pvConCategoria.id, cantidadVendida: 2 }] });

    const hoy = new Date();
    const desde = new Date(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1);
    const rep = await generarReporteVentasPorCategoria(sucursalId, desde, hoy);

    expect(rep.porCategoria.find((c) => c.categoria === "Panadería")?.importe).toBe(100);
    expect(rep.pvSinCategoria).toContain(pvSinCategoria.nombre);
  });
});
