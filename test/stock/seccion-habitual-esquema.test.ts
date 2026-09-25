import { beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { limpiarBaseDeTest, prisma } from "../setup/test-db";

/**
 * Esquema de la sección habitual (migración seccion_habitual_producto, docs/plan-seccion-habitual-stock-2026-09-25.md D1): una fila
 * por sucursal × producto (la segunda choca con el índice único) y las tres referencias son RESTRICT — una sección, un producto o una
 * sucursal con una habitual apuntándoles no se pueden borrar.
 */
describe("SeccionHabitualProducto: esquema", () => {
  let sucursalId: string;
  let productoId: string;
  let seccionId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    sucursalId = (await prisma.sucursal.create({ data: { nombre: "Central" } })).id;
    const unidad = await prisma.unidad.create({ data: { nombre: "unidad", magnitud: "CANTIDAD", decimales: 0 } });
    productoId = (await prisma.producto.create({ data: { codigo: "PV_1", nombre: "Pizza", tipo: "PV", unidadStockId: unidad.id, precioVenta: 1 } })).id;
    seccionId = (await prisma.seccion.create({ data: { sucursalId, nombre: "Cocina" } })).id;
  });

  it("una sola fila por sucursal × producto", async () => {
    await prisma.seccionHabitualProducto.create({ data: { sucursalId, productoId, seccionId } });
    const otra = await prisma.seccion.create({ data: { sucursalId, nombre: "Barra" } });
    const choque = await prisma.seccionHabitualProducto.create({ data: { sucursalId, productoId, seccionId: otra.id } }).catch((e: unknown) => e);
    expect(choque).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect((choque as Prisma.PrismaClientKnownRequestError).code).toBe("P2002");
  });

  it("la sección, el producto y la sucursal referenciados no se pueden borrar (RESTRICT)", async () => {
    await prisma.seccionHabitualProducto.create({ data: { sucursalId, productoId, seccionId } });
    await expect(prisma.seccion.delete({ where: { id: seccionId } })).rejects.toThrow();
    await expect(prisma.producto.delete({ where: { id: productoId } })).rejects.toThrow();
    await expect(prisma.sucursal.delete({ where: { id: sucursalId } })).rejects.toThrow();
  });
});
