"use server";

import { prisma } from "@/lib/db";
import { normalizarTagsCarta, validarImagenUrlCarta, validarOrdenCarta, validarTextoLibreCarta, LARGO_MAXIMO_DESCRIPCION_CARTA } from "@/core/carta/validaciones";
import { conPermiso } from "../con-permiso";
import { error, ok, type ResultadoAccion } from "../tipos";

/**
 * Contenido de cara al cliente de un PV en la carta pública (docs/plan-carta-catalogo-2026-09-24.md, M9): si se muestra, su
 * descripción, imagen, tags, ★ especial y orden. Solo escribe en `ContenidoCartaProducto`; el producto (nombre, precio,
 * categoría, disponibilidad) se sigue editando donde siempre. Sin fila = no se muestra (D3): guardar el contenido de un PV es lo
 * que lo hace aparecer. Gate: `carta`.
 */

export interface DatosContenidoCarta {
  visibleEnCarta: boolean;
  descripcion?: string | null;
  imagenUrl?: string | null;
  /** Lista, o texto separado por comas (como en la sheet). */
  tags?: readonly string[] | string | null;
  especial?: boolean;
  orden?: number | string | null;
}

export async function guardarContenidoCartaProducto(productoId: string, datos: DatosContenidoCarta): Promise<ResultadoAccion> {
  return conPermiso("carta", async () => {
    const producto = await prisma.producto.findUnique({ where: { id: productoId }, select: { nombre: true, tipo: true } });
    if (!producto) return error("No se encontró el producto.");
    if (producto.tipo !== "PV") return error("Solo un producto de venta (PV) puede ir en la carta.");

    const descripcion = validarTextoLibreCarta(datos.descripcion, "La descripción", LARGO_MAXIMO_DESCRIPCION_CARTA);
    if (!descripcion.ok) return error(descripcion.mensaje);
    const imagenUrl = validarImagenUrlCarta(datos.imagenUrl);
    if (!imagenUrl.ok) return error(imagenUrl.mensaje);
    const tags = normalizarTagsCarta(datos.tags);
    if (!tags.ok) return error(tags.mensaje);
    const orden = validarOrdenCarta(datos.orden);
    if (!orden.ok) return error(orden.mensaje);

    const data = {
      visibleEnCarta: datos.visibleEnCarta === true,
      descripcion: descripcion.valor,
      imagenUrl: imagenUrl.valor,
      tags: tags.valor,
      especial: datos.especial === true,
      orden: orden.valor,
    };
    await prisma.contenidoCartaProducto.upsert({ where: { productoId }, update: data, create: { productoId, ...data } });
    return ok(`Carta: "${producto.nombre}" ${data.visibleEnCarta ? "se muestra" : "queda oculto"}.`);
  });
}

/** Atajo para mostrar/ocultar sin tocar el resto del contenido (crea la fila si no existía, con el resto vacío). */
export async function actualizarVisibleEnCarta(productoId: string, visibleEnCarta: boolean): Promise<ResultadoAccion> {
  return conPermiso("carta", async () => {
    const producto = await prisma.producto.findUnique({ where: { id: productoId }, select: { nombre: true, tipo: true } });
    if (!producto) return error("No se encontró el producto.");
    if (producto.tipo !== "PV") return error("Solo un producto de venta (PV) puede ir en la carta.");
    await prisma.contenidoCartaProducto.upsert({ where: { productoId }, update: { visibleEnCarta }, create: { productoId, visibleEnCarta } });
    return ok(`Carta: "${producto.nombre}" ${visibleEnCarta ? "se muestra" : "queda oculto"}.`);
  });
}
