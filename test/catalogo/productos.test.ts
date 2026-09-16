import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { darDeAltaProducto, actualizarProducto, obtenerInsumoDeProducto, asignarInsumoAProducto } from "../../src/server/actions/productos";

describe("productos", () => {
  let unidadKgId: string;
  let unidadGId: string;
  let insumoId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    const catalogo = await sembrarCatalogoBase();
    unidadKgId = catalogo.kg.id;
    unidadGId = catalogo.g.id;
    insumoId = catalogo.insumo.id;

    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  it("da de alta un producto con código autogenerado con el prefijo del tipo", async () => {
    const resultado = await darDeAltaProducto({
      nombre: "Harina 0000",
      tipo: "MP",
      unidadStockId: unidadKgId,
      factorConversion: 1,
      insumoId,
    });
    expect(resultado.ok).toBe(true);

    const creado = await prisma.producto.findFirstOrThrow({ where: { nombre: "Harina 0000" } });
    expect(creado.codigo.startsWith("MP_")).toBe(true);
  });

  it("rechaza nombre duplicado, ignorando mayúsculas", async () => {
    await darDeAltaProducto({ nombre: "Azúcar", tipo: "MP", unidadStockId: unidadKgId, factorConversion: 1 });
    const resultado = await darDeAltaProducto({ nombre: "AZÚCAR", tipo: "MP", unidadStockId: unidadKgId, factorConversion: 1 });
    expect(resultado.ok).toBe(false);
  });

  it("rechaza código manual duplicado", async () => {
    await darDeAltaProducto({ nombre: "Sal", tipo: "MP", codigo: "MP_SAL", unidadStockId: unidadKgId, factorConversion: 1 });
    const resultado = await darDeAltaProducto({
      nombre: "Sal fina",
      tipo: "MP",
      codigo: "MP_SAL",
      unidadStockId: unidadKgId,
      factorConversion: 1,
    });
    expect(resultado.ok).toBe(false);
  });

  it("rechaza combinación Tipo/Uso implícita inválida vía unidad mezclada dentro del mismo insumo", async () => {
    await darDeAltaProducto({ nombre: "Harina marca A", tipo: "MP", unidadStockId: unidadKgId, factorConversion: 1, insumoId });
    const resultado = await darDeAltaProducto({
      nombre: "Harina marca B",
      tipo: "MP",
      unidadStockId: unidadGId,
      factorConversion: 1,
      insumoId,
    });
    expect(resultado.ok).toBe(false);
  });

  it("actualizarProducto permite renombrar sin tocar el código (FK real, no hace falta reescribir historial)", async () => {
    await darDeAltaProducto({ nombre: "Fideos", tipo: "MP", unidadStockId: unidadKgId, factorConversion: 1 });
    const producto = await prisma.producto.findFirstOrThrow({ where: { nombre: "Fideos" } });

    const resultado = await actualizarProducto(producto.id, {
      nombre: "Fideos guiseros",
      tipo: "MP",
      unidadStockId: unidadKgId,
      factorConversion: 1,
    });
    expect(resultado.ok).toBe(true);

    const actualizado = await prisma.producto.findUniqueOrThrow({ where: { id: producto.id } });
    expect(actualizado.codigo).toBe(producto.codigo);
    expect(actualizado.nombre).toBe("Fideos guiseros");
  });

  it("rechaza consignación sin proveedor o sin precio", async () => {
    const resultado = await darDeAltaProducto({
      nombre: "Vino consignado",
      tipo: "MP",
      unidadStockId: unidadKgId,
      factorConversion: 1,
      esConsignacion: true,
    });
    expect(resultado.ok).toBe(false);
  });

  describe("asistente de hermanar (obtenerInsumoDeProducto / asignarInsumoAProducto)", () => {
    it("obtenerInsumoDeProducto devuelve null de insumo si el producto todavía no tiene uno", async () => {
      await darDeAltaProducto({ nombre: "Coca 500cc - Distribuidora Norte", tipo: "MP", unidadStockId: unidadKgId, factorConversion: 1 });
      const producto = await prisma.producto.findFirstOrThrow({ where: { nombre: "Coca 500cc - Distribuidora Norte" } });

      const info = await obtenerInsumoDeProducto(producto.id);
      expect(info?.insumoId).toBeNull();
      expect(info?.unidadStockId).toBe(unidadKgId);
    });

    it("obtenerInsumoDeProducto trae el nombre del insumo si ya está agrupado", async () => {
      await darDeAltaProducto({ nombre: "Harina marca A", tipo: "MP", unidadStockId: unidadKgId, factorConversion: 1, insumoId });
      const producto = await prisma.producto.findFirstOrThrow({ where: { nombre: "Harina marca A" } });

      const info = await obtenerInsumoDeProducto(producto.id);
      expect(info?.insumoId).toBe(insumoId);
      expect(info?.insumoNombre).toBe("Harina");
    });

    it("asignarInsumoAProducto agrupa retroactivamente una MP que no tenía insumo", async () => {
      await darDeAltaProducto({ nombre: "Coca 500cc - Distribuidora Sur", tipo: "MP", unidadStockId: unidadKgId, factorConversion: 1 });
      const producto = await prisma.producto.findFirstOrThrow({ where: { nombre: "Coca 500cc - Distribuidora Sur" } });

      const resultado = await asignarInsumoAProducto(producto.id, insumoId);
      expect(resultado.ok).toBe(true);

      const actualizado = await prisma.producto.findUniqueOrThrow({ where: { id: producto.id } });
      expect(actualizado.insumoId).toBe(insumoId);
    });

    it("asignarInsumoAProducto rechaza si el Insumo ya tiene productos activos con otra unidad de stock", async () => {
      await darDeAltaProducto({ nombre: "Harina marca A", tipo: "MP", unidadStockId: unidadKgId, factorConversion: 1, insumoId });
      await darDeAltaProducto({ nombre: "Harina marca B (en gramos)", tipo: "MP", unidadStockId: unidadGId, factorConversion: 1 });
      const productoB = await prisma.producto.findFirstOrThrow({ where: { nombre: "Harina marca B (en gramos)" } });

      const resultado = await asignarInsumoAProducto(productoB.id, insumoId);
      expect(resultado.ok).toBe(false);

      const actualizado = await prisma.producto.findUniqueOrThrow({ where: { id: productoB.id } });
      expect(actualizado.insumoId).toBeNull();
    });

    it("asignarInsumoAProducto rechaza un PV (solo una MP puede tener insumo)", async () => {
      await darDeAltaProducto({ nombre: "Pizza muzza", tipo: "PV", unidadStockId: unidadKgId, factorConversion: 1 });
      const pv = await prisma.producto.findFirstOrThrow({ where: { nombre: "Pizza muzza" } });

      const resultado = await asignarInsumoAProducto(pv.id, insumoId);
      expect(resultado.ok).toBe(false);
    });
  });
});
