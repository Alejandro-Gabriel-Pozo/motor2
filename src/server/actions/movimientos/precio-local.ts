"use server";

import { prisma } from "@/lib/db";
import { conPermiso } from "../con-permiso";
import { error, ok, type ResultadoAccion } from "../tipos";

/**
 * Port de HOJA_PRECIO_LOCAL/"Precio Local" (Catalogo.js:2043-2077) — hueco
 * encontrado investigando Venta (porción Movimientos): Producto.precioVenta
 * es el precio GLOBAL, esto es el override por sucursal. `resolverPrecioVenta`
 * (src/core/movimientos/precio-venta.ts) es quien lee esto — acá solo el CRUD.
 */
export async function obtenerPrecioLocalProducto(sucursalId: string, productoId: string) {
  return prisma.precioLocalProducto.findUnique({ where: { sucursalId_productoId: { sucursalId, productoId } } });
}

export async function listarPreciosLocales(sucursalId: string) {
  return prisma.precioLocalProducto.findMany({ where: { sucursalId }, include: { producto: true }, orderBy: { producto: { nombre: "asc" } } });
}

export async function setPrecioLocalProducto(productoId: string, precio: number, habilitado: boolean): Promise<ResultadoAccion> {
  return conPermiso("precio_local", async (ctx) => {
    if (!(precio >= 0)) return error("El precio no puede ser negativo.");

    const producto = await prisma.producto.findUnique({ where: { id: productoId } });
    if (!producto) return error("No se encontró el producto.");

    await prisma.precioLocalProducto.upsert({
      where: { sucursalId_productoId: { sucursalId: ctx.sucursalId, productoId } },
      update: { precio, habilitado },
      create: { sucursalId: ctx.sucursalId, productoId, precio, habilitado },
    });
    return ok(`Precio local de "${producto.nombre}" ${habilitado ? `fijado en ${precio}` : "cargado (deshabilitado, se usa el precio global)"}.`);
  });
}
