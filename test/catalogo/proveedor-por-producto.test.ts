import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { obtenerComparativaPreciosPorInsumo, listarProductosDeProveedor } from "../../src/server/actions/catalogo/proveedor-por-producto";
import { upsertProveedorPorProducto } from "../../src/server/actions/catalogo/upsert-proveedor-por-producto";

describe("ProveedorPorProducto (sin gate propio)", () => {
  let productoId: string;
  let proveedorAId: string;
  let proveedorBId: string;
  let unidadCompraId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    // Las lecturas (obtenerComparativaPreciosPorInsumo, listarProductosDeProveedor) exigen una sesión; el upsert es un ayudante interno.
    const base = await sembrarBase();
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
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

  it("un referenciaProveedor vacío nunca pisa uno ya cargado (mismo criterio que el precio)", async () => {
    await upsertProveedorPorProducto({
      productoId, proveedorId: proveedorAId, unidadCompraId, precioUnitario: 100, precioPorUnidadStock: 100, referenciaProveedor: "ACE-5L",
    });
    await upsertProveedorPorProducto({ productoId, proveedorId: proveedorAId, unidadCompraId, precioUnitario: 110, precioPorUnidadStock: 110 });

    const fila = await prisma.proveedorPorProducto.findUniqueOrThrow({
      where: { productoId_proveedorId_unidadCompraId: { productoId, proveedorId: proveedorAId, unidadCompraId } },
    });
    expect(fila.referenciaProveedor).toBe("ACE-5L");
  });

  it("referenciaProveedor se puede actualizar mandando un valor nuevo no vacío", async () => {
    await upsertProveedorPorProducto({
      productoId, proveedorId: proveedorAId, unidadCompraId, precioUnitario: 100, precioPorUnidadStock: 100, referenciaProveedor: "ACE-5L",
    });
    await upsertProveedorPorProducto({
      productoId, proveedorId: proveedorAId, unidadCompraId, precioUnitario: 110, precioPorUnidadStock: 110, referenciaProveedor: "ACEITE-BIDON-5",
    });

    const fila = await prisma.proveedorPorProducto.findUniqueOrThrow({
      where: { productoId_proveedorId_unidadCompraId: { productoId, proveedorId: proveedorAId, unidadCompraId } },
    });
    expect(fila.referenciaProveedor).toBe("ACEITE-BIDON-5");
  });

  describe("listarProductosDeProveedor", () => {
    it("trae los productos ya comprados a ese proveedor, más recientes primero", async () => {
      const producto2 = await prisma.producto.create({
        data: { codigo: "MP_TEST_2", nombre: "Vinagre", tipo: "MP", unidadStockId: unidadCompraId },
      });

      await upsertProveedorPorProducto({
        productoId, proveedorId: proveedorAId, unidadCompraId, precioUnitario: 100, precioPorUnidadStock: 100,
        fechaCompra: new Date("2026-01-01"), referenciaProveedor: "ACE-5L",
      });
      await upsertProveedorPorProducto({
        productoId: producto2.id, proveedorId: proveedorAId, unidadCompraId, precioUnitario: 50, precioPorUnidadStock: 50,
        fechaCompra: new Date("2026-02-01"),
      });
      // A otro proveedor no debería aparecer en la lista de A.
      await upsertProveedorPorProducto({ productoId, proveedorId: proveedorBId, unidadCompraId, precioUnitario: 999, precioPorUnidadStock: 999 });

      const lista = await listarProductosDeProveedor(proveedorAId);
      expect(lista).toHaveLength(2);
      expect(lista[0].productoId).toBe(producto2.id); // más reciente primero
      expect(lista[1]).toMatchObject({ productoId, referenciaProveedor: "ACE-5L", ultimoPrecioPorUnidadStock: 100 });
    });

    it("sin ninguna compra a ese proveedor, da vacío", async () => {
      expect(await listarProductosDeProveedor(proveedorAId)).toEqual([]);
    });

    it("no trae productos inactivos", async () => {
      await upsertProveedorPorProducto({ productoId, proveedorId: proveedorAId, unidadCompraId, precioUnitario: 100, precioPorUnidadStock: 100 });
      await prisma.producto.update({ where: { id: productoId }, data: { activo: false } });

      expect(await listarProductosDeProveedor(proveedorAId)).toEqual([]);
    });
  });
});
