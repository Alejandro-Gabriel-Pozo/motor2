"use server";

import { prisma } from "@/lib/db";
import { esNumeroFinito } from "@/core/numero";
import { conPermiso } from "../con-permiso";
import { error, ok, type ResultadoAccion } from "../tipos";
import { requerirVerEnSucursal } from "../con-sesion";

/** Todas las filas (global + por sección) de Stock Mínimo de esta sucursal — para el panel de administración. */
export async function listarStockMinimo(sucursalId: string) {
  await requerirVerEnSucursal(sucursalId, "stock_minimo");
  return prisma.stockMinimoProducto.findMany({
    where: { sucursalId },
    include: { producto: true, seccion: true },
    orderBy: [{ producto: { nombre: "asc" } }],
  });
}

/**
 * Port de setStockMinimoProducto_ (Catalogo.js:1982-2008). `seccionId`
 * null/omitido = fija el mínimo GLOBAL de esta sucursal (aplica salvo que
 * haya una fila más específica para una sección puntual).
 */
export async function setStockMinimoProducto(productoId: string, minimo: number, seccionId?: string | null): Promise<ResultadoAccion> {
  return conPermiso("stock_minimo", async (ctx) => {
    if (!(minimo >= 0)) return error("El mínimo no puede ser negativo.");
    if (!esNumeroFinito(minimo)) return error("El mínimo no es un número válido.");

    const producto = await prisma.producto.findUnique({ where: { id: productoId } });
    if (!producto) return error("No se encontró el producto.");

    if (seccionId) {
      const seccion = await prisma.seccion.findUnique({ where: { id: seccionId } });
      if (!seccion || seccion.sucursalId !== ctx.sucursalId) return error("No se encontró la sección.");

      await prisma.stockMinimoProducto.upsert({
        where: { productoId_seccionId: { productoId, seccionId } },
        update: { minimo },
        create: { sucursalId: ctx.sucursalId, productoId, seccionId, minimo },
      });
      return ok(`Stock mínimo de "${producto.nombre}" en "${seccion.nombre}" actualizado.`);
    }

    // Fila "global" (seccionId null) — el índice único parcial
    // (sucursalId, productoId) WHERE seccionId IS NULL (ver migración
    // manual, README) es el árbitro final; acá se busca a mano porque
    // Prisma no puede expresar un `where` de upsert sobre un índice
    // parcial, solo sobre una @@unique declarada en el schema.
    const existente = await prisma.stockMinimoProducto.findFirst({ where: { sucursalId: ctx.sucursalId, productoId, seccionId: null } });
    if (existente) {
      await prisma.stockMinimoProducto.update({ where: { id: existente.id }, data: { minimo } });
    } else {
      await prisma.stockMinimoProducto.create({ data: { sucursalId: ctx.sucursalId, productoId, minimo } });
    }
    return ok(`Stock mínimo (global) de "${producto.nombre}" actualizado.`);
  });
}

export async function eliminarStockMinimo(id: string): Promise<ResultadoAccion> {
  return conPermiso("stock_minimo", async (ctx) => {
    const fila = await prisma.stockMinimoProducto.findUnique({ where: { id } });
    if (!fila || fila.sucursalId !== ctx.sucursalId) return error("No se encontró esa fila de Stock Mínimo.");
    await prisma.stockMinimoProducto.delete({ where: { id } });
    return ok("Stock mínimo eliminado.");
  });
}
