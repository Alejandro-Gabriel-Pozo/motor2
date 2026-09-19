"use server";

import { prisma } from "@/lib/db";
import { registrarCambioAuditado } from "@/core/permisos/auditoria";
import { esNumeroFinito } from "@/core/numero";
import { conPermiso } from "../con-permiso";
import { error, ok, type ResultadoAccion } from "../tipos";
import { requerirVerEnSucursal } from "../con-sesion";

/**
 * Port de HOJA_PRECIO_LOCAL/"Precio Local" (Catalogo.js:2043-2077) — hueco
 * encontrado investigando Venta (porción Movimientos): Producto.precioVenta
 * es el precio GLOBAL, esto es el override por sucursal. `resolverPrecioVenta`
 * (src/core/movimientos/precio-venta.ts) es quien lee esto — acá solo el CRUD.
 */
export async function obtenerPrecioLocalProducto(sucursalId: string, productoId: string) {
  await requerirVerEnSucursal(sucursalId, "precio_local");
  return prisma.precioLocalProducto.findUnique({ where: { sucursalId_productoId: { sucursalId, productoId } } });
}

export async function listarPreciosLocales(sucursalId: string) {
  await requerirVerEnSucursal(sucursalId, "precio_local");
  return prisma.precioLocalProducto.findMany({ where: { sucursalId }, include: { producto: true }, orderBy: { producto: { nombre: "asc" } } });
}

export async function setPrecioLocalProducto(productoId: string, precio: number, habilitado: boolean): Promise<ResultadoAccion> {
  return conPermiso("precio_local", async (ctx) => {
    if (!(precio >= 0)) return error("El precio no puede ser negativo.");
    if (!esNumeroFinito(precio)) return error("El precio no es un número válido.");

    const producto = await prisma.producto.findUnique({ where: { id: productoId } });
    if (!producto) return error("No se encontró el producto.");

    const existente = await prisma.precioLocalProducto.findUnique({ where: { sucursalId_productoId: { sucursalId: ctx.sucursalId, productoId } } });
    const fila = await prisma.precioLocalProducto.upsert({
      where: { sucursalId_productoId: { sucursalId: ctx.sucursalId, productoId } },
      update: { precio, habilitado },
      create: { sucursalId: ctx.sucursalId, productoId, precio, habilitado },
    });

    // Auditoría administrativa (A3, Pivote 6).
    await registrarCambioAuditado(prisma, {
      entidad: "PrecioLocalProducto", entidadId: fila.id, campo: "precio",
      descripcion: `Precio local de "${producto.nombre}"`,
      valorAnterior: existente ? Number(existente.precio) : null, valorNuevo: Number(precio), actorId: ctx.usuarioId, sucursalId: ctx.sucursalId,
    });
    await registrarCambioAuditado(prisma, {
      entidad: "PrecioLocalProducto", entidadId: fila.id, campo: "habilitado",
      descripcion: `Precio local de "${producto.nombre}": habilitado`,
      valorAnterior: existente?.habilitado ?? null, valorNuevo: habilitado, actorId: ctx.usuarioId, sucursalId: ctx.sucursalId,
    });

    return ok(`Precio local de "${producto.nombre}" ${habilitado ? `fijado en ${precio}` : "cargado (deshabilitado, se usa el precio global)"}.`);
  });
}
