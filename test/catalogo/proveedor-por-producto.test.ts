import { beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, sembrarCatalogoBase, prisma } from "../setup/test-db";
import { upsertProveedorPorProducto, obtenerComparativaPreciosPorInsumo } from "../../src/server/actions/proveedor-por-producto";

describe("ProveedorPorProducto (sin gate propio)", () => {
  let productoId: string;
  let proveedorAId: string;
  let proveedorBId: string;
  let unidadCompraId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const catalogo = await sembrarCatalogoBase();
    unidadCompraId = catalogo.kg.id;

    const producto = await prisma.producto.create({
      data: { codigo: "MP_TEST", nombre: "Aceite", tipo: "MP", unidadStockId: catalogo.kg.id, insumoId: catalogo.insumo.id },
    });
    productoId = producto.id;

    const [a, b] = await Promise.all([
      prisma.proveedor.create({ data: { codigo: "PRV_A", nombre: "Proveedor A" } }),
      prisma.proveedor.create({ data: { codigo: "PRV_B", nombre: "Proveedor B" } }),
    ]);
    proveedorAId = a.id;
    proveedorBId = b.id;
  });

  it("dos upserts concurrentes sobre la misma clave nunca crean dos filas", async () => {
    await Promise.all([
      upsertProveedorPorProducto({ productoId, proveedorId: proveedorAId, unidadCompraId, precioUnitario: 100, precioPorUnidadStock: 100 }),
      upsertProveedorPorProducto({ productoId, proveedorId: proveedorAId, unidadCompraId, precioUnitario: 110, precioPorUnidadStock: 110 }),
    ]);

    const cantidad = await prisma.proveedorPorProducto.count({ where: { productoId, proveedorId: proveedorAId, unidadCompraId } });
    expect(cantidad).toBe(1);
  });

  it("un precio 0 nunca pisa un precio bueno ya cargado", async () => {
    await upsertProveedorPorProducto({ productoId, proveedorId: proveedorAId, unidadCompraId, precioUnitario: 500, precioPorUnidadStock: 500 });
    await upsertProveedorPorProducto({ productoId, proveedorId: proveedorAId, unidadCompraId, precioUnitario: 0, precioPorUnidadStock: 0 });

    const fila = await prisma.proveedorPorProducto.findUniqueOrThrow({
      where: { productoId_proveedorId_unidadCompraId: { productoId, proveedorId: proveedorAId, unidadCompraId } },
    });
    expect(Number(fila.precioPorUnidadStock)).toBe(500);
  });

  it("la comparativa nunca elige como 'más barato' una oferta en 0", async () => {
    await upsertProveedorPorProducto({ productoId, proveedorId: proveedorAId, unidadCompraId, precioUnitario: 0, precioPorUnidadStock: 0 });
    await upsertProveedorPorProducto({ productoId, proveedorId: proveedorBId, unidadCompraId, precioUnitario: 500, precioPorUnidadStock: 500 });

    const comparativa = await obtenerComparativaPreciosPorInsumo();
    const fila = comparativa.find((f) => f.insumo === "Harina"); // insumo sembrado en sembrarCatalogoBase
    expect(fila?.masBarato?.proveedorNombre).toBe("Proveedor B");
  });
});
