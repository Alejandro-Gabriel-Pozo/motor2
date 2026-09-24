"use server";

import { prisma } from "@/lib/db";
import { validarImagenUrlCarta, validarNombreSeccionCarta, validarOrdenCarta, validarTextoLibreCarta, LARGO_MAXIMO_DESCRIPCION_CARTA, LARGO_MAXIMO_TITULO_CARTA } from "@/core/carta/validaciones";
import { conPermiso } from "../con-permiso";
import { error, ok, okConId, type ResultadoAccion, type ResultadoConId } from "../tipos";

/**
 * Secciones de carta y la tabla puente categoría → sección (docs/plan-carta-catalogo-2026-09-24.md, M9). Globales (Catálogo
 * Central, decisión D4). Solo escriben en las tablas de carta (`SeccionCarta`, `CategoriaSeccionCarta`): la categoría en sí
 * no se toca. Gate: `carta` (solo admin en la semilla).
 */

export interface DatosSeccionCarta {
  /** Sin id = alta; con id = edición. */
  id?: string;
  nombre: string;
  titulo?: string | null;
  descripcion?: string | null;
  imagenUrl?: string | null;
  orden?: number | string | null;
}

export async function guardarSeccionCarta(datos: DatosSeccionCarta): Promise<ResultadoConId> {
  return conPermiso<ResultadoConId>("carta", async () => {
    const nombre = validarNombreSeccionCarta(datos.nombre);
    if (!nombre.ok) return error(nombre.mensaje);
    const titulo = validarTextoLibreCarta(datos.titulo, "El título", LARGO_MAXIMO_TITULO_CARTA);
    if (!titulo.ok) return error(titulo.mensaje);
    const descripcion = validarTextoLibreCarta(datos.descripcion, "La descripción", LARGO_MAXIMO_DESCRIPCION_CARTA);
    if (!descripcion.ok) return error(descripcion.mensaje);
    const imagenUrl = validarImagenUrlCarta(datos.imagenUrl);
    if (!imagenUrl.ok) return error(imagenUrl.mensaje);
    const orden = validarOrdenCarta(datos.orden);
    if (!orden.ok) return error(orden.mensaje);

    const repetida = await prisma.seccionCarta.findFirst({
      where: { nombre: { equals: nombre.valor, mode: "insensitive" }, ...(datos.id ? { NOT: { id: datos.id } } : {}) },
    });
    if (repetida) return error(`Ya existe la sección de carta "${repetida.nombre}".`);

    const data = { nombre: nombre.valor, titulo: titulo.valor, descripcion: descripcion.valor, imagenUrl: imagenUrl.valor, orden: orden.valor };
    if (datos.id) {
      const existente = await prisma.seccionCarta.findUnique({ where: { id: datos.id } });
      if (!existente) return error("No se encontró la sección de carta.");
      const s = await prisma.seccionCarta.update({ where: { id: datos.id }, data });
      return okConId(`Sección de carta "${s.nombre}" guardada.`, s.id, s.nombre);
    }
    const s = await prisma.seccionCarta.create({ data });
    return okConId(`Sección de carta "${s.nombre}" creada.`, s.id, s.nombre);
  });
}

/** Nunca se borra una sección de carta: se apaga (deja de salir en la carta con todo lo suyo) y se puede volver a prender. */
export async function actualizarActivaSeccionCarta(seccionCartaId: string, activa: boolean): Promise<ResultadoAccion> {
  return conPermiso("carta", async () => {
    const existente = await prisma.seccionCarta.findUnique({ where: { id: seccionCartaId } });
    if (!existente) return error("No se encontró la sección de carta.");
    await prisma.seccionCarta.update({ where: { id: seccionCartaId }, data: { activa } });
    return ok(`Sección de carta "${existente.nombre}" ${activa ? "activada" : "desactivada"}.`);
  });
}

/**
 * Pone una categoría en una sección de carta (o la cambia de sección), con su orden dentro de ella. `seccionCartaId` null la
 * saca de la carta: se borra la fila puente, que es solo una referencia (la categoría y sus productos no cambian).
 */
export async function asignarCategoriaASeccionCarta(categoriaId: string, seccionCartaId: string | null, orden: number | string | null = 0): Promise<ResultadoAccion> {
  return conPermiso("carta", async () => {
    const categoria = await prisma.categoriaProducto.findUnique({ where: { id: categoriaId } });
    if (!categoria) return error("No se encontró la categoría.");

    if (!seccionCartaId) {
      await prisma.categoriaSeccionCarta.deleteMany({ where: { categoriaId } });
      return ok(`La categoría "${categoria.nombre}" ya no está en ninguna sección de carta.`);
    }

    const o = validarOrdenCarta(orden);
    if (!o.ok) return error(o.mensaje);
    const seccion = await prisma.seccionCarta.findUnique({ where: { id: seccionCartaId } });
    if (!seccion) return error("No se encontró la sección de carta.");

    await prisma.categoriaSeccionCarta.upsert({
      where: { categoriaId },
      update: { seccionCartaId, orden: o.valor },
      create: { categoriaId, seccionCartaId, orden: o.valor },
    });
    return ok(`La categoría "${categoria.nombre}" va en la sección de carta "${seccion.nombre}".`);
  });
}
