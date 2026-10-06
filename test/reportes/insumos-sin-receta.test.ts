import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarProductoDisponible, prisma } from "../setup/test-db";
import { generarReporteInsumosSinRecetaVinculada } from "../../src/core/reportes/insumos-sin-receta";

describe("generarReporteInsumosSinRecetaVinculada", () => {
  it("detecta la MP huérfana (sin ninguna receta) y excluye la que sí está vinculada", async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    const sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();

    const huerfana = await sembrarProductoDisponible({ codigo: "MP_HUERFANA", nombre: "Sin nadie que la use", tipo: "MP", unidadStockId: catalogo.kg.id, insumoId: catalogo.insumo.id }, sucursalId);
    const vinculada = await sembrarProductoDisponible({ codigo: "MP_VINCULADA", nombre: "Harina de receta", tipo: "MP", unidadStockId: catalogo.kg.id }, sucursalId);
    const pv = await sembrarProductoDisponible({ codigo: "PV_1", nombre: "Pan", tipo: "PV", unidadStockId: catalogo.kg.id, precioVenta: 100 }, sucursalId);
    await prisma.recetaVersion.create({ data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: vinculada.id, cantidad: 1, unidadId: catalogo.kg.id }] } } });

    const filas = await generarReporteInsumosSinRecetaVinculada(sucursalId, prisma);
    expect(filas.map((f) => f.productoId)).toContain(huerfana.id);
    expect(filas.map((f) => f.productoId)).not.toContain(vinculada.id);
  });

  it("marca tieneProveedor según si hay alguna fila de ProveedorPorProducto cargada", async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    const sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    const proveedor = await prisma.proveedor.create({ data: { codigo: "PRV_1", nombre: "Molino" } });
    const conProveedor = await sembrarProductoDisponible({ codigo: "MP_1", nombre: "Con proveedor", tipo: "MP", unidadStockId: catalogo.kg.id, insumoId: catalogo.insumo.id }, sucursalId);
    const sinProveedor = await sembrarProductoDisponible({ codigo: "MP_2", nombre: "Sin proveedor", tipo: "MP", unidadStockId: catalogo.kg.id }, sucursalId);
    await prisma.proveedorPorProducto.create({ data: { productoId: conProveedor.id, proveedorId: proveedor.id, unidadCompraId: catalogo.kg.id, precioUnitario: 10, precioPorUnidadStock: 10 } });

    const filas = await generarReporteInsumosSinRecetaVinculada(sucursalId, prisma);
    expect(filas.find((f) => f.productoId === conProveedor.id)?.tieneProveedor).toBe(true);
    expect(filas.find((f) => f.productoId === sinProveedor.id)?.tieneProveedor).toBe(false);
  });

  it("una MP huérfana disponible solo en OTRA sucursal no aparece acá", async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    const sucursalId = base.sucursal.id;
    const otraSucursalId = (await prisma.sucursal.create({ data: { nombre: "Otra" } })).id;
    const catalogo = await sembrarCatalogoBase();

    const huerfana = await sembrarProductoDisponible({ codigo: "MP_OTRA", nombre: "Solo en otra", tipo: "MP", unidadStockId: catalogo.kg.id, insumoId: catalogo.insumo.id }, otraSucursalId);

    const filas = await generarReporteInsumosSinRecetaVinculada(sucursalId, prisma);
    expect(filas.map((f) => f.productoId)).not.toContain(huerfana.id);
  });
});
