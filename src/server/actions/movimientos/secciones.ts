"use server";

import { prisma } from "@/lib/db";
import { texto, validarTextoCatalogo } from "@/core/texto";
import { conPermiso } from "../con-permiso";
import { error, ok, okConId, type ResultadoAccion, type ResultadoConId } from "../tipos";
import { requerirSesionEnSucursal } from "../con-sesion";

/**
 * Port de HOJA_SECCIONES (Stock.js:1316-1415) — antes una hoja POR
 * CONTENEDOR (cada sucursal ya tenía sus propias Secciones porque cada una
 * era un spreadsheet separado); acá sucursalId es una columna real. Las
 * acciones de listado son públicas (sin gate propio) para poblar los
 * <select> de los paneles de carga de Movimientos — mismo criterio que
 * `obtenerSeccionesParaCarga` en Apps Script.
 */
export async function listarSeccionesActivas(sucursalId: string) {
  await requerirSesionEnSucursal(sucursalId);
  return prisma.seccion.findMany({ where: { sucursalId, activa: true }, orderBy: { nombre: "asc" } });
}

/** Todas (activas e inactivas) — para el panel de administración. */
export async function listarSeccionesParaPanel(sucursalId: string) {
  await requerirSesionEnSucursal(sucursalId);
  return prisma.seccion.findMany({ where: { sucursalId }, orderBy: { nombre: "asc" } });
}

/** Alta de una sección nueva. Admin-only ('secciones'): define el catálogo cerrado que van a usar todos los operadores de esa sucursal. */
export async function crearSeccion(nombre: string): Promise<ResultadoConId> {
  return conPermiso<ResultadoConId>("secciones", async (ctx) => {
    const nombreLimpio = texto(nombre);
    if (!nombreLimpio) return error("El nombre de la sección no puede estar vacío.");
    const invalido = validarTextoCatalogo(nombreLimpio, "El nombre de la sección");
    if (invalido) return error(invalido);

    const existente = await prisma.seccion.findFirst({
      where: { sucursalId: ctx.sucursalId, nombre: { equals: nombreLimpio, mode: "insensitive" } },
    });
    if (existente) {
      return error(`Ya existe una sección "${nombreLimpio}" en esta sucursal (las secciones no distinguen mayúsculas/espacios).`);
    }

    const creada = await prisma.seccion.create({ data: { sucursalId: ctx.sucursalId, nombre: nombreLimpio } });
    return okConId(`Sección "${creada.nombre}" creada.`, creada.id, creada.nombre);
  });
}

/**
 * Renombrar una sección existente — antes solo se podía elegir el nombre
 * una vez, al crearla; la única salida era desactivarla y crear una
 * nueva, fragmentando el historial del Kardex (mismo hueco ya señalado
 * para Proveedores). El Kardex ya escrito referencia la sección por FK,
 * así que renombrarla no rompe nada de lo ya cargado.
 */
export async function renombrarSeccion(seccionId: string, nombreNuevo: string): Promise<ResultadoAccion> {
  return conPermiso("secciones", async (ctx) => {
    const nombre = texto(nombreNuevo);
    if (!nombre) return error("El nombre no puede estar vacío.");
    const invalido = validarTextoCatalogo(nombre, "El nombre de la sección");
    if (invalido) return error(invalido);

    const seccion = await prisma.seccion.findUnique({ where: { id: seccionId } });
    if (!seccion || seccion.sucursalId !== ctx.sucursalId) return error("No se encontró la sección.");

    const existente = await prisma.seccion.findFirst({
      where: { sucursalId: ctx.sucursalId, nombre: { equals: nombre, mode: "insensitive" }, id: { not: seccionId } },
    });
    if (existente) return error(`Ya existe una sección "${existente.nombre}" en esta sucursal.`);

    await prisma.seccion.update({ where: { id: seccionId }, data: { nombre } });
    return ok(`Sección renombrada a "${nombre}".`);
  });
}

/** Activa/desactiva una sección. No se borra: el Kardex ya escrito con esa sección sigue siendo válido, solo deja de ofrecerse para cargas nuevas. */
export async function actualizarActivaSeccion(seccionId: string, activa: boolean): Promise<ResultadoAccion> {
  return conPermiso("secciones", async (ctx) => {
    const seccion = await prisma.seccion.findUnique({ where: { id: seccionId } });
    if (!seccion || seccion.sucursalId !== ctx.sucursalId) return error("No se encontró la sección.");

    await prisma.seccion.update({ where: { id: seccionId }, data: { activa } });
    return ok(`Sección "${seccion.nombre}" ${activa ? "activada" : "desactivada"}.`);
  });
}
