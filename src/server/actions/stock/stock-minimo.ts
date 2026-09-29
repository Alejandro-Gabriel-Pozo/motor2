"use server";

import { esNumeroFinito } from "@/core/numero";
import { conPermiso } from "../con-permiso";
import { error, ok, type ResultadoAccion } from "../tipos";
import { requerirVerEnSucursal } from "../con-sesion";

/** Todas las filas (global + por sección) de Stock Mínimo de esta sucursal — para el panel de administración. */
export async function listarStockMinimo(sucursalId: string) {
  const ctx = await requerirVerEnSucursal(sucursalId, "stock_minimo");
  return ctx.db.stockMinimoProducto.findMany({
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

    const producto = await ctx.db.producto.findUnique({ where: { id: productoId } });
    if (!producto) return error("No se encontró el producto.");

    if (seccionId) {
      const seccion = await ctx.db.seccion.findUnique({ where: { id: seccionId } });
      if (!seccion || seccion.sucursalId !== ctx.sucursalId) return error("No se encontró la sección.");

      await ctx.db.stockMinimoProducto.upsert({
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
    const existente = await ctx.db.stockMinimoProducto.findFirst({ where: { sucursalId: ctx.sucursalId, productoId, seccionId: null } });
    if (existente) {
      await ctx.db.stockMinimoProducto.update({ where: { id: existente.id }, data: { minimo } });
    } else {
      await ctx.db.stockMinimoProducto.create({ data: { sucursalId: ctx.sucursalId, productoId, minimo } });
    }
    return ok(`Stock mínimo (global) de "${producto.nombre}" actualizado.`);
  });
}

export async function eliminarStockMinimo(id: string): Promise<ResultadoAccion> {
  return conPermiso("stock_minimo", async (ctx) => {
    const fila = await ctx.db.stockMinimoProducto.findUnique({ where: { id } });
    if (!fila || fila.sucursalId !== ctx.sucursalId) return error("No se encontró esa fila de Stock Mínimo.");
    await ctx.db.stockMinimoProducto.delete({ where: { id } });
    return ok("Stock mínimo eliminado.");
  });
}
