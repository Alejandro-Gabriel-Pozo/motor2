"use server";

import { prisma } from "@/lib/db";
import { validarImagenUrlCarta, validarNombreSeccionCarta, validarOrdenCarta, validarTextoLibreCarta, LARGO_MAXIMO_DESCRIPCION_CARTA, LARGO_MAXIMO_TITULO_CARTA } from "@/core/carta/validaciones";
import { conPermiso } from "../con-permiso";
import { error, ok, okConId, type ResultadoAccion, type ResultadoConId } from "../tipos";
import { revalidarCartasPublicas } from "./revalidar";

/**
 * Secciones de carta (docs/plan-carta-catalogo-2026-09-24.md, M9). Globales (Catálogo Central, decisión D4). Solo escriben en
 * `SeccionCarta`. Cada producto suelto y cada ítem agrupado elige su sección directo (docs/plan-carta-seccion-directa-2026-09-25.md):
 * la Categoría de producto no ubica nada en la carta. Gate: `carta` (solo admin en la semilla).
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
      revalidarCartasPublicas();
      return okConId(`Sección de carta "${s.nombre}" guardada.`, s.id, s.nombre);
    }
    const s = await prisma.seccionCarta.create({ data });
    revalidarCartasPublicas();
    return okConId(`Sección de carta "${s.nombre}" creada.`, s.id, s.nombre);
  });
}

/** Nunca se borra una sección de carta: se apaga (deja de salir en la carta con todo lo suyo) y se puede volver a prender. */
export async function actualizarActivaSeccionCarta(seccionCartaId: string, activa: boolean): Promise<ResultadoAccion> {
  return conPermiso("carta", async () => {
    const existente = await prisma.seccionCarta.findUnique({ where: { id: seccionCartaId } });
    if (!existente) return error("No se encontró la sección de carta.");
    await prisma.seccionCarta.update({ where: { id: seccionCartaId }, data: { activa } });
    revalidarCartasPublicas();
    return ok(`Sección de carta "${existente.nombre}" ${activa ? "activada" : "desactivada"}.`);
  });
}
