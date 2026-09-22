"use server";

import { prisma } from "@/lib/db";
import { esNumeroFinito } from "@/core/numero";
import { conPermiso } from "../con-permiso";
import { error, ok, type ResultadoAccion } from "../tipos";
import { requerirVerEnSucursal } from "../con-sesion";

/**
 * Agenda de conteo físico periódico por sucursal × producto (sub-plan S,
 * docs/plan-rendimiento-recetas-2026-09-22.md §E). Reusa el permiso
 * `proceso_control` ("Registrar un Conteo Físico") en vez de crear uno
 * nuevo (decisión S2 del plan): quien cuenta es quien configura cada
 * cuánto — mismo criterio que ya gatea `/reportes/conteos` y
 * `/stock/reclasificar`.
 */
export async function listarFrecuenciasConteo(sucursalId: string) {
  await requerirVerEnSucursal(sucursalId, "proceso_control");
  return prisma.frecuenciaConteoProducto.findMany({
    where: { sucursalId },
    include: { producto: true },
    orderBy: [{ producto: { nombre: "asc" } }],
  });
}

/** `frecuenciaDias === 0` desactiva la agenda de este producto (se conserva la fila, mismo criterio "0 es un valor real" de setStockMinimoProducto — no se borra, se pisa). */
export async function setFrecuenciaConteo(productoId: string, frecuenciaDias: number): Promise<ResultadoAccion> {
  return conPermiso("proceso_control", async (ctx) => {
    if (!Number.isInteger(frecuenciaDias) || frecuenciaDias < 0) return error("La frecuencia tiene que ser un número entero de días, 0 o más.");
    if (!esNumeroFinito(frecuenciaDias)) return error("La frecuencia no es un número válido.");

    const producto = await prisma.producto.findUnique({ where: { id: productoId } });
    if (!producto) return error("No se encontró el producto.");

    await prisma.frecuenciaConteoProducto.upsert({
      where: { sucursalId_productoId: { sucursalId: ctx.sucursalId, productoId } },
      update: { frecuenciaDias },
      create: { sucursalId: ctx.sucursalId, productoId, frecuenciaDias },
    });
    return ok(frecuenciaDias === 0 ? `Agenda de conteo de "${producto.nombre}" desactivada.` : `Agenda de conteo de "${producto.nombre}" fijada cada ${frecuenciaDias} día(s).`);
  });
}

export async function eliminarFrecuenciaConteo(id: string): Promise<ResultadoAccion> {
  return conPermiso("proceso_control", async (ctx) => {
    const fila = await prisma.frecuenciaConteoProducto.findUnique({ where: { id } });
    if (!fila || fila.sucursalId !== ctx.sucursalId) return error("No se encontró esa fila de Frecuencia de conteo.");
    await prisma.frecuenciaConteoProducto.delete({ where: { id } });
    return ok("Fila de Frecuencia de conteo eliminada.");
  });
}
