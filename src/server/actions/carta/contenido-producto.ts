"use server";

import { prisma } from "@/lib/db";
import { normalizarTagsCarta, validarOrdenCarta, validarTextoLibreCarta, LARGO_MAXIMO_DESCRIPCION_CARTA } from "@/core/carta/validaciones";
import { conPermiso } from "../con-permiso";
import { error, ok, type ResultadoAccion } from "../tipos";

/**
 * Contenido de cara al cliente de un PV en la carta pública (docs/plan-carta-catalogo-2026-09-24.md, M9): si se muestra, en qué
 * sección de carta, su descripción, tags, ★ especial y orden. La sección se elige DIRECTO, sin Categoría de producto de por medio,
 * y no hay imagen por producto: la carta solo dibuja la de la sección (docs/plan-carta-seccion-directa-2026-09-25.md). Solo escribe
 * en `ContenidoCartaProducto`; el producto (nombre, precio, categoría, disponibilidad) se sigue editando donde siempre. Sin fila =
 * no se muestra (D3): guardar el contenido de un PV es lo que lo hace aparecer. Gate: `carta`.
 */

const MENSAJE_FALTA_SECCION = "Elegí la sección de carta donde se muestra (sin sección no puede salir en la carta).";

export interface DatosContenidoCarta {
  visibleEnCarta: boolean;
  /** Obligatoria si `visibleEnCarta` (DA2); vacío/null = sin sección (solo para un contenido oculto). */
  seccionCartaId?: string | null;
  descripcion?: string | null;
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
    const tags = normalizarTagsCarta(datos.tags);
    if (!tags.ok) return error(tags.mensaje);
    const orden = validarOrdenCarta(datos.orden);
    if (!orden.ok) return error(orden.mensaje);

    const visibleEnCarta = datos.visibleEnCarta === true;
    const seccionCartaId = datos.seccionCartaId?.trim() || null;
    // DA2: visible exige sección; oculto se puede guardar sin ella (por si se vuelve a mostrar después).
    if (visibleEnCarta && !seccionCartaId) return error(MENSAJE_FALTA_SECCION);
    if (seccionCartaId) {
      const seccion = await prisma.seccionCarta.findUnique({ where: { id: seccionCartaId }, select: { id: true } });
      if (!seccion) return error("No se encontró la sección de carta.");
    }

    const data = {
      visibleEnCarta,
      seccionCartaId,
      descripcion: descripcion.valor,
      tags: tags.valor,
      especial: datos.especial === true,
      orden: orden.valor,
    };
    await prisma.contenidoCartaProducto.upsert({ where: { productoId }, update: data, create: { productoId, ...data } });
    return ok(`Carta: "${producto.nombre}" ${data.visibleEnCarta ? "se muestra" : "queda oculto"}.`);
  });
}

/**
 * Atajo para mostrar/ocultar sin tocar el resto del contenido (crea la fila si no existía, con el resto vacío). Mostrar exige que
 * el contenido ya tenga sección de carta (DA2): si no, hay que elegirla con `guardarContenidoCartaProducto`.
 */
export async function actualizarVisibleEnCarta(productoId: string, visibleEnCarta: boolean): Promise<ResultadoAccion> {
  return conPermiso("carta", async () => {
    const producto = await prisma.producto.findUnique({ where: { id: productoId }, select: { nombre: true, tipo: true, contenidoCarta: { select: { seccionCartaId: true } } } });
    if (!producto) return error("No se encontró el producto.");
    if (producto.tipo !== "PV") return error("Solo un producto de venta (PV) puede ir en la carta.");
    if (visibleEnCarta && !producto.contenidoCarta?.seccionCartaId) return error(MENSAJE_FALTA_SECCION);
    await prisma.contenidoCartaProducto.upsert({ where: { productoId }, update: { visibleEnCarta }, create: { productoId, visibleEnCarta } });
    return ok(`Carta: "${producto.nombre}" ${visibleEnCarta ? "se muestra" : "queda oculto"}.`);
  });
}
