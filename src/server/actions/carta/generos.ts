"use server";

import { validarNombreGeneroCarta, validarOrdenCarta } from "@/core/carta/validaciones";
import { whereCartaDeSucursal } from "@/core/carta/public";
import { conPermisoDeEmpresa } from "../con-permiso";
import { error, ok, okConId, type ResultadoAccion, type ResultadoConId } from "../tipos";
import { revalidarCartasPublicas } from "./revalidar";

/**
 * Géneros de carta (docs/plan-genero-carta-2026-09-26.md): carpetas VISUALES del POS que agrupan, dentro de una sección de
 * carta, tanto productos sueltos como ítems agrupados que comparten género ("Cerveza"). No
 * implican precio ni sustituibilidad (eso lo sigue manejando `ItemAgrupadoCarta`); no son `Grupo` (Insumo/stock) ni
 * `CategoriaProducto` (que no ubica nada en la carta). Solo escriben en `GeneroCarta`. Son PROPIOS de cada sucursal (ADR-009, C3): se crean y
 * se editan siempre en la sucursal activa. Gate: `carta_generos`.
 */

export interface DatosGeneroCarta {
  /** Sin id = alta; con id = edición. */
  id?: string;
  nombre: string;
  orden?: number | string | null;
}

export async function guardarGeneroCarta(datos: DatosGeneroCarta): Promise<ResultadoConId> {
  return conPermisoDeEmpresa<ResultadoConId>("carta_generos", async (ctx) => {
    const nombre = validarNombreGeneroCarta(datos.nombre);
    if (!nombre.ok) return error(nombre.mensaje);
    const orden = validarOrdenCarta(datos.orden);
    if (!orden.ok) return error(orden.mensaje);

    const repetido = await ctx.db.generoCarta.findFirst({
      where: { nombre: { equals: nombre.valor, mode: "insensitive" }, ...whereCartaDeSucursal(ctx.sucursalId), ...(datos.id ? { NOT: { id: datos.id } } : {}) },
    });
    if (repetido) return error(`Ya existe el género "${repetido.nombre}".`);

    const data = { nombre: nombre.valor, orden: orden.valor };
    if (datos.id) {
      const existente = await ctx.db.generoCarta.findUnique({ where: { id: datos.id, ...whereCartaDeSucursal(ctx.sucursalId) } });
      if (!existente) return error("No se encontró el género.");
      const g = await ctx.db.generoCarta.update({ where: { id: datos.id }, data });
      revalidarCartasPublicas();
      return okConId(`Género "${g.nombre}" guardado.`, g.id, g.nombre);
    }
    const g = await ctx.db.generoCarta.create({ data: { sucursalId: ctx.sucursalId, ...data } });
    revalidarCartasPublicas();
    return okConId(`Género "${g.nombre}" creado.`, g.id, g.nombre);
  });
}

/** Nunca se borra un género: se apaga (deja de mostrarse como carpeta; lo que tenía ese género queda suelto, sin error, D). */
export async function actualizarActivoGeneroCarta(generoCartaId: string, activo: boolean): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("carta_generos", async (ctx) => {
    const existente = await ctx.db.generoCarta.findUnique({ where: { id: generoCartaId, ...whereCartaDeSucursal(ctx.sucursalId) } });
    if (!existente) return error("No se encontró el género.");
    await ctx.db.generoCarta.update({ where: { id: generoCartaId }, data: { activo } });
    revalidarCartasPublicas();
    return ok(`Género "${existente.nombre}" ${activo ? "activado" : "desactivado"}.`);
  });
}
