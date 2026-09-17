import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { calcularCostosYMargenes, calcularImpactoInsumos } from "../../src/core/reportes/costos";

describe("calcularCostosYMargenes", () => {
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

  it("usa la ÚLTIMA compra registrada (no la más barata) como costo de reposición", async () => {
    const mp = await prisma.producto.create({ data: { codigo: "MP_1", nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, insumoId } });
    const pv = await prisma.producto.create({ data: { codigo: "PV_1", nombre: "Pan", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 100 } });
    await prisma.recetaVersion.create({ data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 2, unidadId: unidadKgId }] } } });

    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-01-01"), seccionId, items: [{ productoId: mp.id, cantidad: 10, precioTotal: 100 }] }); // $10/kg
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-06-01"), seccionId, items: [{ productoId: mp.id, cantidad: 10, precioTotal: 150 }] }); // $15/kg, más cara y más reciente

    const filas = await calcularCostosYMargenes(sucursalId);
    const fila = filas.find((f) => f.productoId === pv.id)!;
    expect(fila.costo).toBe(2 * 15); // usa el precio de la compra más reciente, no la más barata
  });

  it("marca costoIncompleto sin inventar un margen cuando falta el precio de algún insumo de la receta", async () => {
    const mp1 = await prisma.producto.create({ data: { codigo: "MP_1", nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, insumoId } });
    const mp2 = await prisma.producto.create({ data: { codigo: "MP_2", nombre: "Levadura", tipo: "MP", unidadStockId: unidadKgId } });
    const pv = await prisma.producto.create({ data: { codigo: "PV_1", nombre: "Pan", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 100 } });
    await prisma.recetaVersion.create({
      data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp1.id, cantidad: 1, unidadId: unidadKgId }, { insumoProductoId: mp2.id, cantidad: 1, unidadId: unidadKgId }] } },
    });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp1.id, cantidad: 10, precioTotal: 100 }] });
    // mp2 nunca se compró: sin costo conocido.

    const filas = await calcularCostosYMargenes(sucursalId);
    const fila = filas.find((f) => f.productoId === pv.id)!;
    expect(fila.costoIncompleto).toBe(true);
    expect(fila.costo).toBeNull();
    expect(fila.margen).toBeNull();
    expect(fila.componentes.find((c) => c.insumoProductoId === mp2.id)?.sinPrecio).toBe(true);
  });

  it("margen se calcula sobre la receta CON merma aplicada", async () => {
    const mp = await prisma.producto.create({ data: { codigo: "MP_1", nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, insumoId } });
    const pv = await prisma.producto.create({ data: { codigo: "PV_1", nombre: "Pan", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 100 } });
    await prisma.recetaVersion.create({ data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 1, unidadId: unidadKgId, mermaPorcentaje: 10 }] } } });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 10, precioTotal: 100 }] }); // $10/kg

    const filas = await calcularCostosYMargenes(sucursalId);
    const fila = filas.find((f) => f.productoId === pv.id)!;
    expect(fila.costo).toBeCloseTo(1 * 1.1 * 10); // cantidad × (1+merma%) × costo unitario
    expect(fila.margen).toBeCloseTo(100 - 11);
  });

  it("lee el Kardex LOCAL de la sucursal para el costo, no otra sucursal", async () => {
    const otraSucursal = await prisma.sucursal.create({ data: { nombre: "Otra" } });
    const otraSeccion = await sembrarSeccion(otraSucursal.id, "Depósito 2");
    const mp = await prisma.producto.create({ data: { codigo: "MP_1", nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, insumoId } });
    const pv = await prisma.producto.create({ data: { codigo: "PV_1", nombre: "Pan", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 100 } });
    await prisma.recetaVersion.create({ data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 1, unidadId: unidadKgId }] } } });

    const usuarioOtra = await crearUsuarioConMembresia({ email: "otra@test.com", sucursalId: otraSucursal.id, rolId: (await prisma.rol.findFirstOrThrow({ where: { nombre: "admin" } })).id });
    await prisma.operacion.create({
      data: {
        sucursalId: otraSucursal.id, proceso: "COMPRA", fecha: new Date(), usuarioId: usuarioOtra.id,
        movimientos: { create: [{ productoId: mp.id, seccionId: otraSeccion.id, proceso: "COMPRA", cantidad: 10, detalle: "Compra otra sucursal.", precioTotal: 1000, precioPorUnidadStock: 100 }] },
      },
    });
    // La sucursal bajo prueba nunca compró esta MP.

    const filas = await calcularCostosYMargenes(sucursalId);
    const fila = filas.find((f) => f.productoId === pv.id)!;
    expect(fila.costoIncompleto).toBe(true); // no toma el precio $100/kg de la otra sucursal
  });
});

describe("calcularImpactoInsumos", () => {
  it("acumula el costo por insumo a través de varios platos que lo usan", async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    const catalogo = await sembrarCatalogoBase();
    const seccion = await sembrarSeccion(base.sucursal.id);
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });

    const mp = await prisma.producto.create({ data: { codigo: "MP_1", nombre: "Harina", tipo: "MP", unidadStockId: catalogo.kg.id, insumoId: catalogo.insumo.id } });
    const pv1 = await prisma.producto.create({ data: { codigo: "PV_1", nombre: "Pan", tipo: "PV", unidadStockId: catalogo.kg.id, precioVenta: 100 } });
    const pv2 = await prisma.producto.create({ data: { codigo: "PV_2", nombre: "Torta", tipo: "PV", unidadStockId: catalogo.kg.id, precioVenta: 200 } });
    await prisma.recetaVersion.create({ data: { productoId: pv1.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 1, unidadId: catalogo.kg.id }] } } });
    await prisma.recetaVersion.create({ data: { productoId: pv2.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 2, unidadId: catalogo.kg.id }] } } });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId: seccion.id, items: [{ productoId: mp.id, cantidad: 10, precioTotal: 100 }] }); // $10/kg

    const impacto = await calcularImpactoInsumos(base.sucursal.id);
    const fila = impacto.find((i) => i.insumoProductoId === mp.id)!;
    expect(fila.cantidadPlatos).toBe(2);
    expect(fila.costoAcumulado).toBeCloseTo(1 * 10 + 2 * 10);
  });
});
