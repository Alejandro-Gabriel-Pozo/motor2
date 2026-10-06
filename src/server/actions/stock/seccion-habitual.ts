"use server";

import { guardSeccionHabitual } from "@/core/features/seccion-habitual/seccion-habitual.guard";
import { conPermiso } from "../con-permiso";
import { error, ok, type ResultadoAccion } from "../tipos";
import { requerirVerEnSucursal } from "../con-sesion";

/**
 * Sección HABITUAL de un producto de venta en esta sucursal (docs/plan-seccion-habitual-stock-2026-09-25.md, C1/C2): de qué sección
 * de STOCK sale primero lo que consume al cerrar una cuenta del salón. Fila ausente = sin preferencia (el cierre resuelve solo, por
 * vencimiento). Reusa el permiso `stock_minimo` en vez de crear uno nuevo (mismo criterio que la Frecuencia de conteo reusó
 * `proceso_control`): es configuración de stock por sucursal × producto, la misma gente que fija mínimos.
 */

/** Las filas de esta sucursal — solo las que apuntan a una sección ACTIVA de esta sucursal (una desactivada ya no manda, ver el cierre). */
export async function listarSeccionesHabituales(sucursalId: string) {
  const ctx = await requerirVerEnSucursal(sucursalId, "stock_seccion_habitual");
  return ctx.db.seccionHabitualProducto.findMany({
    where: { sucursalId, seccion: { sucursalId, activa: true } },
    include: { producto: true, seccion: true },
    orderBy: [{ producto: { nombre: "asc" } }],
  });
}

/** Alta o reemplazo (una por sucursal × producto). Solo un PV, y solo una sección activa de esta sucursal. */
export async function setSeccionHabitual(productoId: string, seccionId: string): Promise<ResultadoAccion> {
  return conPermiso("stock_seccion_habitual", async (ctx) => {
    const formato = guardSeccionHabitual({ productoId, seccionId });
    if (!formato.ok) return error(formato.mensaje);

    const producto = await ctx.db.producto.findUnique({ where: { id: formato.valor.productoId } });
    if (!producto) return error("No se encontró el producto.");
    if (producto.tipo !== "PV") return error(`Solo un producto de venta (PV) tiene sección habitual: «${producto.nombre}» es una materia prima.`);

    const seccion = await ctx.db.seccion.findUnique({ where: { id: formato.valor.seccionId } });
    if (!seccion || seccion.sucursalId !== ctx.sucursalId) return error("No se encontró la sección.");
    if (!seccion.activa) return error(`La sección «${seccion.nombre}» está desactivada: activala o elegí otra.`);

    await ctx.db.seccionHabitualProducto.upsert({
      where: { sucursalId_productoId: { sucursalId: ctx.sucursalId, productoId: producto.id } },
      update: { seccionId: seccion.id },
      create: { sucursalId: ctx.sucursalId, productoId: producto.id, seccionId: seccion.id },
    });
    return ok(`Sección habitual de «${producto.nombre}»: «${seccion.nombre}».`);
  });
}

/** Quita la preferencia: el producto vuelve a salir de donde haya stock (por vencimiento). */
export async function eliminarSeccionHabitual(id: string): Promise<ResultadoAccion> {
  return conPermiso("stock_seccion_habitual", async (ctx) => {
    const fila = typeof id === "string" ? await ctx.db.seccionHabitualProducto.findUnique({ where: { id }, include: { producto: { select: { nombre: true } } } }) : null;
    if (!fila || fila.sucursalId !== ctx.sucursalId) return error("No se encontró esa sección habitual.");
    await ctx.db.seccionHabitualProducto.delete({ where: { id: fila.id } });
    return ok(`«${fila.producto.nombre}» ya no tiene sección habitual.`);
  });
}
