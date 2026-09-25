"use server";

import { prisma } from "@/lib/db";
import { validarOrdenCarta, validarPrecioCarta, validarTextoLibreCarta, LARGO_MAXIMO_DESCRIPCION_CARTA, LARGO_MAXIMO_TITULO_CARTA } from "@/core/carta/validaciones";
import { conPermiso } from "../con-permiso";
import { error, ok, type ResultadoAccion } from "../tipos";

/**
 * Promos INFORMATIVAS de la carta de la sucursal activa (docs/plan-carta-catalogo-2026-09-24.md, M9, D5): título, descripción
 * y precio dentro de una sección de carta. No referencian productos ni mueven stock (la composición real queda para "tomar
 * pedido"). Solo escriben en `PromoCarta`, siempre de la sucursal ACTIVA de quien llama: una promo de otra sucursal no se puede
 * editar pasando su id. Nunca se borran: se apagan. Gate: `carta`.
 */

export interface DatosPromoCarta {
  /** Sin id = alta; con id = edición. */
  id?: string;
  seccionCartaId: string;
  titulo: string;
  descripcion?: string | null;
  precio: number | string;
  orden?: number | string | null;
}

export async function guardarPromoCarta(datos: DatosPromoCarta): Promise<ResultadoAccion> {
  return conPermiso("carta", async (ctx) => {
    const titulo = validarTextoLibreCarta(datos.titulo, "El título", LARGO_MAXIMO_TITULO_CARTA);
    if (!titulo.ok) return error(titulo.mensaje);
    if (!titulo.valor) return error("La promo necesita un título.");
    const descripcion = validarTextoLibreCarta(datos.descripcion, "La descripción", LARGO_MAXIMO_DESCRIPCION_CARTA);
    if (!descripcion.ok) return error(descripcion.mensaje);
    const precio = validarPrecioCarta(datos.precio);
    if (!precio.ok) return error(precio.mensaje);
    const orden = validarOrdenCarta(datos.orden);
    if (!orden.ok) return error(orden.mensaje);

    const seccion = await prisma.seccionCarta.findUnique({ where: { id: datos.seccionCartaId } });
    if (!seccion) return error("No se encontró la sección de carta.");

    const data = { seccionCartaId: seccion.id, titulo: titulo.valor, descripcion: descripcion.valor, precio: precio.valor, orden: orden.valor };
    if (datos.id) {
      const existente = await prisma.promoCarta.findUnique({ where: { id: datos.id } });
      if (!existente || existente.sucursalId !== ctx.sucursalId) return error("No se encontró la promo en esta sucursal.");
      await prisma.promoCarta.update({ where: { id: datos.id }, data });
      return ok(`Promo "${titulo.valor}" guardada.`);
    }
    await prisma.promoCarta.create({ data: { ...data, sucursalId: ctx.sucursalId } });
    return ok(`Promo "${titulo.valor}" creada en "${seccion.nombre}".`);
  });
}

export async function actualizarActivaPromoCarta(promoCartaId: string, activa: boolean): Promise<ResultadoAccion> {
  return conPermiso("carta", async (ctx) => {
    const existente = await prisma.promoCarta.findUnique({ where: { id: promoCartaId } });
    if (!existente || existente.sucursalId !== ctx.sucursalId) return error("No se encontró la promo en esta sucursal.");
    await prisma.promoCarta.update({ where: { id: promoCartaId }, data: { activa } });
    return ok(`Promo "${existente.titulo}" ${activa ? "activada" : "desactivada"}.`);
  });
}
