import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { registrarVenta } from "../../src/server/actions/movimientos/venta";
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

  it("gastoPorInsumo agrupa por Insumo/Grupo en vez de por proveedor, distinto de compras.porProveedor", async () => {
    const grupo = await prisma.grupo.create({ data: { nombre: "Secos" } });
    await prisma.insumo.update({ where: { id: insumoId }, data: { grupoId: grupo.id } });
    const mp1 = await prisma.producto.create({ data: { codigo: "MP_H1", nombre: "Harina 000", tipo: "MP", unidadStockId: unidadKgId, insumoId } });
    const mp2 = await prisma.producto.create({ data: { codigo: "MP_H2", nombre: "Harina 0000", tipo: "MP", unidadStockId: unidadKgId, insumoId } }); // mismo Insumo "Harina", producto distinto
    const proveedorA = await prisma.proveedor.create({ data: { codigo: "PRV_A", nombre: "Molino A" } });
    const proveedorB = await prisma.proveedor.create({ data: { codigo: "PRV_B", nombre: "Molino B" } });

    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, proveedorId: proveedorA.id, items: [{ productoId: mp1.id, cantidad: 10, precioTotal: 300 }] });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, proveedorId: proveedorB.id, items: [{ productoId: mp2.id, cantidad: 5, precioTotal: 200 }] });

    const rep = await obtenerReportePorPeriodo(sucursalId, new Date(Date.now() - 86400000), new Date(Date.now() + 86400000));

    // Los dos productos son el MISMO insumo ("Harina") — se juntan en una sola fila, a diferencia de compras.porProveedor (2 filas, una por proveedor).
    expect(rep.gastoPorInsumo.porInsumo).toHaveLength(1);
    const fila = rep.gastoPorInsumo.porInsumo[0]!;
    expect(fila.insumo).toBe("Harina");
    expect(fila.grupo).toBe("Secos");
    expect(fila.importe).toBe(500);
    expect(fila.porcentaje).toBe(100); // único insumo del período
    expect(fila.porcentajeAcumulado).toBe(100);
    expect(fila.cantidadCompras).toBe(2);
    expect(fila.proveedores.sort()).toEqual(["Molino A", "Molino B"]);

    expect(rep.gastoPorInsumo.porGrupo).toEqual([{ grupo: "Secos", importe: 500 }]);
    expect(rep.compras.porProveedor).toHaveLength(2); // confirma que sigue siendo una vista distinta
  });

  it("gastoPorInsumo calcula % y % acumulado (regla 80/20) sobre 2+ insumos, ordenado de mayor a menor gasto", async () => {
    const mp1 = await prisma.producto.create({ data: { codigo: "MP_H1", nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, insumoId } });
    const insumo2 = await prisma.insumo.create({ data: { nombre: "Muzzarella" } });
    const mp2 = await prisma.producto.create({ data: { codigo: "MP_M1", nombre: "Muzzarella", tipo: "MP", unidadStockId: unidadKgId, insumoId: insumo2.id } });

    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp2.id, cantidad: 1, precioTotal: 750 }] }); // 75% del gasto
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp1.id, cantidad: 1, precioTotal: 250 }] }); // 25% del gasto

    const rep = await obtenerReportePorPeriodo(sucursalId, new Date(Date.now() - 86400000), new Date(Date.now() + 86400000));

    expect(rep.gastoPorInsumo.porInsumo.map((f) => f.insumo)).toEqual(["Muzzarella", "Harina"]); // mayor gasto primero
    expect(rep.gastoPorInsumo.porInsumo[0]!.porcentaje).toBe(75);
    expect(rep.gastoPorInsumo.porInsumo[0]!.porcentajeAcumulado).toBe(75);
    expect(rep.gastoPorInsumo.porInsumo[1]!.porcentaje).toBe(25);
    expect(rep.gastoPorInsumo.porInsumo[1]!.porcentajeAcumulado).toBe(100);
  });

  it("gastoPorInsumo separa 'Sin insumo asignado' de 'Sin categoría' cuando el producto no tiene Insumo", async () => {
    const mpSinInsumo = await prisma.producto.create({ data: { codigo: "MP_SUELTO", nombre: "Producto suelto", tipo: "MP", unidadStockId: unidadKgId } });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mpSinInsumo.id, cantidad: 1, precioTotal: 50 }] });

    const rep = await obtenerReportePorPeriodo(sucursalId, new Date(Date.now() - 86400000), new Date(Date.now() + 86400000));

    expect(rep.gastoPorInsumo.porInsumo).toEqual([
      expect.objectContaining({ insumo: "Sin insumo asignado", grupo: null, importe: 50 }),
    ]);
    expect(rep.gastoPorInsumo.porGrupo).toEqual([{ grupo: "Sin categoría", importe: 50 }]);
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

  it("ratioGastoVentas compara Compras/Ventas del período contra el período inmediato anterior de igual duración", async () => {
    const mp = await prisma.producto.create({ data: { codigo: "MP_1", nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, insumoId } });
    const pv = await prisma.producto.create({ data: { codigo: "PV_1", nombre: "Pan", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 100 } });

    // Período anterior (9 de agosto, un día antes del rango elegido): compró 80, facturó 100 -> 80%.
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-08-09T12:00:00.000Z"), seccionId, items: [{ productoId: mp.id, cantidad: 1, precioTotal: 80 }] });
    await registrarVenta({ fecha: new Date("2026-08-09T12:00:00.000Z"), seccionId, ventas: [{ productoId: pv.id, cantidadVendida: 1 }] });

    // Período elegido (10 de agosto): compró 100, facturó 200 -> 50%.
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-08-10T12:00:00.000Z"), seccionId, items: [{ productoId: mp.id, cantidad: 1, precioTotal: 100 }] });
    await registrarVenta({ fecha: new Date("2026-08-10T12:00:00.000Z"), seccionId, ventas: [{ productoId: pv.id, cantidadVendida: 2 }] });

    const rep = await obtenerReportePorPeriodo(sucursalId, new Date("2026-08-10"), new Date("2026-08-10"));

    expect(rep.ratioGastoVentas.porcentaje).toBe(50);
    expect(rep.ratioGastoVentas.porcentajePeriodoAnterior).toBe(80);
  });

  it("ratioGastoVentas da null (no divide por cero) si no hubo ventas facturadas", async () => {
    const mp = await prisma.producto.create({ data: { codigo: "MP_1", nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, insumoId } });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 1, precioTotal: 100 }] });

    const rep = await obtenerReportePorPeriodo(sucursalId, new Date(Date.now() - 86400000), new Date(Date.now() + 86400000));
    expect(rep.ratioGastoVentas.porcentaje).toBeNull();
  });

  it("tendenciaPrecios ordena por impacto en $, no por %: un insumo caro con suba moderada pesa más que uno barato con suba grande", async () => {
    const barato = await prisma.insumo.create({ data: { nombre: "Orégano" } });
    const mpBarato = await prisma.producto.create({ data: { codigo: "MP_OREGANO", nombre: "Orégano", tipo: "MP", unidadStockId: unidadKgId, insumoId: barato.id } });
    const caro = await prisma.insumo.create({ data: { nombre: "Muzzarella" } });
    const mpCaro = await prisma.producto.create({ data: { codigo: "MP_MUZZA", nombre: "Muzzarella", tipo: "MP", unidadStockId: unidadKgId, insumoId: caro.id } });

    // Orégano: $10/kg -> $20/kg dentro del período (+100%, pero solo 1kg -> impacto $10).
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-08-05T12:00:00.000Z"), seccionId, items: [{ productoId: mpBarato.id, cantidad: 1, precioTotal: 10 }] });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-08-11T12:00:00.000Z"), seccionId, items: [{ productoId: mpBarato.id, cantidad: 1, precioTotal: 20 }] });

    // Muzzarella: $1000/kg -> $1100/kg dentro del período (+10%, pero 50kg -> impacto $5000).
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-08-05T12:00:00.000Z"), seccionId, items: [{ productoId: mpCaro.id, cantidad: 50, precioTotal: 50000 }] });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-08-11T12:00:00.000Z"), seccionId, items: [{ productoId: mpCaro.id, cantidad: 50, precioTotal: 55000 }] });

    const rep = await obtenerReportePorPeriodo(sucursalId, new Date("2026-08-10"), new Date("2026-08-14"));

    expect(rep.tendenciaPrecios.map((f) => f.insumo)).toEqual(["Muzzarella", "Orégano"]); // el impacto en $ manda, no el %
    const muzza = rep.tendenciaPrecios[0]!;
    expect(muzza.precioUnitarioAnterior).toBe(1000);
    expect(muzza.precioUnitarioPromedio).toBe(1100);
    expect(muzza.deltaPct).toBe(10);
    expect(muzza.deltaImpacto).toBe(5000);

    const oregano = rep.tendenciaPrecios[1]!;
    expect(oregano.deltaPct).toBe(100);
    expect(oregano.deltaImpacto).toBe(10);
  });

  it("tendenciaPrecios: primera compra de un insumo da delta null (no hay con qué comparar); una variación poco creíble se marca sospechosa", async () => {
    const insumoNuevo = await prisma.insumo.create({ data: { nombre: "Insumo nuevo" } });
    const mpNuevo = await prisma.producto.create({ data: { codigo: "MP_NUEVO", nombre: "Insumo nuevo", tipo: "MP", unidadStockId: unidadKgId, insumoId: insumoNuevo.id } });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mpNuevo.id, cantidad: 1, precioTotal: 100 }] });

    const insumoSal = await prisma.insumo.create({ data: { nombre: "Sal" } });
    const mpSal = await prisma.producto.create({ data: { codigo: "MP_SAL", nombre: "Sal", tipo: "MP", unidadStockId: unidadKgId, insumoId: insumoSal.id } });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(Date.now() - 172800000), seccionId, items: [{ productoId: mpSal.id, cantidad: 10, precioTotal: 10 }] }); // $1/kg, antes del período
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mpSal.id, cantidad: 1, precioTotal: 50 }] }); // $50/kg — +4900%, probable error de carga

    const rep = await obtenerReportePorPeriodo(sucursalId, new Date(Date.now() - 86400000), new Date(Date.now() + 86400000));

    const nuevo = rep.tendenciaPrecios.find((f) => f.insumo === "Insumo nuevo")!;
    expect(nuevo.precioUnitarioAnterior).toBeNull();
    expect(nuevo.deltaPct).toBeNull();
    expect(nuevo.deltaImpacto).toBeNull();
    expect(nuevo.sospechoso).toBe(false);

    const sal = rep.tendenciaPrecios.find((f) => f.insumo === "Sal")!;
    expect(sal.sospechoso).toBe(true);
  });

  it("tendenciaPrecios excluye productos sin Insumo asignado (mezclar precios sin relación no tiene sentido)", async () => {
    const mpSuelto = await prisma.producto.create({ data: { codigo: "MP_SUELTO", nombre: "Producto suelto", tipo: "MP", unidadStockId: unidadKgId } });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mpSuelto.id, cantidad: 1, precioTotal: 50 }] });

    const rep = await obtenerReportePorPeriodo(sucursalId, new Date(Date.now() - 86400000), new Date(Date.now() + 86400000));
    expect(rep.tendenciaPrecios).toEqual([]);
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
