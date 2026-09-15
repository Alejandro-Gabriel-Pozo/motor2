import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, prisma } from "../setup/test-db";
import { generarReporteInsumosSinRecetaVinculada } from "../../src/core/reportes/insumos-sin-receta";

describe("generarReporteInsumosSinRecetaVinculada", () => {
  it("detecta la MP huérfana (sin ninguna receta) y excluye la que sí está vinculada", async () => {
    await limpiarBaseDeTest();
    await sembrarBase();
    const catalogo = await sembrarCatalogoBase();

    const huerfana = await prisma.producto.create({ data: { codigo: "MP_HUERFANA", nombre: "Sin nadie que la use", tipo: "MP", unidadStockId: catalogo.kg.id, insumoId: catalogo.insumo.id } });
    const vinculada = await prisma.producto.create({ data: { codigo: "MP_VINCULADA", nombre: "Harina de receta", tipo: "MP", unidadStockId: catalogo.kg.id } });
    const pv = await prisma.producto.create({ data: { codigo: "PV_1", nombre: "Pan", tipo: "PV", unidadStockId: catalogo.kg.id, precioVenta: 100 } });
    await prisma.recetaVersion.create({ data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: vinculada.id, cantidad: 1, unidadId: catalogo.kg.id }] } } });

    const filas = await generarReporteInsumosSinRecetaVinculada();
    expect(filas.map((f) => f.productoId)).toContain(huerfana.id);
    expect(filas.map((f) => f.productoId)).not.toContain(vinculada.id);
  });

  it("marca tieneProveedor según si hay alguna fila de ProveedorPorProducto cargada", async () => {
    await limpiarBaseDeTest();
    await sembrarBase();
    const catalogo = await sembrarCatalogoBase();
    const proveedor = await prisma.proveedor.create({ data: { codigo: "PRV_1", nombre: "Molino" } });
    const conProveedor = await prisma.producto.create({ data: { codigo: "MP_1", nombre: "Con proveedor", tipo: "MP", unidadStockId: catalogo.kg.id, insumoId: catalogo.insumo.id } });
    const sinProveedor = await prisma.producto.create({ data: { codigo: "MP_2", nombre: "Sin proveedor", tipo: "MP", unidadStockId: catalogo.kg.id } });
    await prisma.proveedorPorProducto.create({ data: { productoId: conProveedor.id, proveedorId: proveedor.id, unidadCompraId: catalogo.kg.id, precioUnitario: 10, precioPorUnidadStock: 10 } });

    const filas = await generarReporteInsumosSinRecetaVinculada();
    expect(filas.find((f) => f.productoId === conProveedor.id)?.tieneProveedor).toBe(true);
    expect(filas.find((f) => f.productoId === sinProveedor.id)?.tieneProveedor).toBe(false);
  });
});
