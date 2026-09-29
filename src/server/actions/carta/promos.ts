"use server";

import { prisma } from "@/lib/db";
import { precioMinimoPromo } from "@/core/pos/promo-combo";
import {
  validarCantidadCupoPromo,
  validarOrdenCarta,
  validarPrecioCarta,
  validarTextoLibreCarta,
  LARGO_MAXIMO_DESCRIPCION_CARTA,
  LARGO_MAXIMO_TITULO_CARTA,
} from "@/core/carta/validaciones";
import { conPermiso } from "../con-permiso";
import { error, ok, type ResultadoAccion } from "../tipos";
import { revalidarCartasPublicas } from "./revalidar";

/**
 * Promos de la carta de la sucursal activa (docs/plan-carta-catalogo-2026-09-24.md, M9, D5): título, descripción y precio
 * dentro de una sección de carta. Solo escriben en `PromoCarta`/`PromoCartaCupo`, siempre de la sucursal ACTIVA de quien
 * llama: una promo de otra sucursal no se puede editar pasando su id. Nunca se borran: se apagan. Gate: `carta`.
 *
 * SIN ningún cupo (`guardarCuposPromoCarta` nunca la tocó, o se le guardó una lista vacía): sigue siendo puramente
 * INFORMATIVA, no referencia productos ni mueve stock — el POS la ignora (`selector-carta.ts`). CON uno o más cupos
 * (Task #16, docs/plan-promo-combo-2026-09-26.md): pasa a ser ARMABLE, ver el docstring de `PromoCarta` en schema.prisma.
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
      revalidarCartasPublicas();
      return ok(`Promo "${titulo.valor}" guardada.`);
    }
    await prisma.promoCarta.create({ data: { ...data, sucursalId: ctx.sucursalId } });
    revalidarCartasPublicas();
    return ok(`Promo "${titulo.valor}" creada en "${seccion.nombre}".`);
  });
}

export async function actualizarActivaPromoCarta(promoCartaId: string, activa: boolean): Promise<ResultadoAccion> {
  return conPermiso("carta", async (ctx) => {
    const existente = await prisma.promoCarta.findUnique({ where: { id: promoCartaId } });
    if (!existente || existente.sucursalId !== ctx.sucursalId) return error("No se encontró la promo en esta sucursal.");
    await prisma.promoCarta.update({ where: { id: promoCartaId }, data: { activa } });
    revalidarCartasPublicas();
    return ok(`Promo "${existente.titulo}" ${activa ? "activada" : "desactivada"}.`);
  });
}

/** Un cupo tal como lo manda el formulario del admin (paso 5, docs/plan-promo-combo-2026-09-26.md). */
export interface DatosCupoPromoCarta {
  seccionCartaId: string;
  /** Vacío/null → 0 (D1: el mínimo por defecto es 0). */
  cantidadMinima?: number | string | null;
  cantidadMaxima: number | string;
}

/**
 * Reemplaza TODOS los cupos de una promo, todo o nada (Task #16, docs/plan-promo-combo-2026-09-26.md, D1): la lista que llega
 * es la lista final — un cupo que no está en `cupos` se borra. Una lista VACÍA vuelve la promo a informativa (sin backfill: no
 * hay forma de "recuperar" cupos borrados salvo cargarlos de nuevo). Gate: `carta`, sucursal ACTIVA de quien llama.
 *
 * Validación:
 * - cada cupo elige una `SeccionCarta` que existe, sin repetir sección entre cupos de la MISMA promo (`@@unique` de
 *   `PromoCartaCupo`, pero se valida antes para un mensaje claro en vez de un error de unicidad crudo);
 * - `cantidadMinima` (0 por defecto) ≤ `cantidadMaxima`, las dos enteras entre 0 y 999;
 * - el precio de la promo tiene que alcanzar el PISO de $0,01 por unidad en el PEOR CASO (todos los cupos en su máximo) —
 *   `precioMinimoPromo` (`src/core/pos/promo-combo.ts`, D3): sin esto, una elección real podría no tener forma de prorratear
 *   sin dejar algún componente en $0 (`prorratearPrecioPromo` vuelve a validarlo, por si la composición real de una
 *   instancia queda más chica que el peor caso, D1).
 */
export async function guardarCuposPromoCarta(promoCartaId: string, cupos: readonly DatosCupoPromoCarta[]): Promise<ResultadoAccion> {
  return conPermiso("carta", async (ctx) => {
    const promo = await prisma.promoCarta.findUnique({ where: { id: promoCartaId } });
    if (!promo || promo.sucursalId !== ctx.sucursalId) return error("No se encontró la promo en esta sucursal.");

    const seccionIds = new Set<string>();
    const cuposValidados: { seccionCartaId: string; cantidadMinima: number; cantidadMaxima: number; orden: number }[] = [];
    for (const [i, c] of cupos.entries()) {
      if (!c.seccionCartaId) return error("Elegí la sección de cada cupo.");
      if (seccionIds.has(c.seccionCartaId)) return error("No se puede repetir la misma sección de carta en dos cupos de la misma promo.");
      seccionIds.add(c.seccionCartaId);

      const minima = validarCantidadCupoPromo(c.cantidadMinima, "La cantidad mínima", 0);
      if (!minima.ok) return error(minima.mensaje);
      const maxima = validarCantidadCupoPromo(c.cantidadMaxima, "La cantidad máxima");
      if (!maxima.ok) return error(maxima.mensaje);
      if (maxima.valor < 1) return error("La cantidad máxima de un cupo tiene que ser al menos 1.");
      if (minima.valor > maxima.valor) return error("En cada cupo, el mínimo no puede ser mayor que el máximo.");

      cuposValidados.push({ seccionCartaId: c.seccionCartaId, cantidadMinima: minima.valor, cantidadMaxima: maxima.valor, orden: i });
    }

    if (cuposValidados.length) {
      const secciones = await prisma.seccionCarta.findMany({ where: { id: { in: [...seccionIds] } }, select: { id: true } });
      if (secciones.length !== seccionIds.size) return error("Alguna sección de carta de los cupos no existe.");

      // D3: peor caso = todos los cupos en su máximo — el precio tiene que alcanzar el piso de $0,01 por unidad ahí también,
      // no solo en la elección mínima.
      const unidadesEnElPeorCaso = cuposValidados.reduce((suma, c) => suma + c.cantidadMaxima, 0);
      const minimoPrecio = precioMinimoPromo([{ cantidad: unidadesEnElPeorCaso }]);
      if (Number(promo.precio) < minimoPrecio) {
        return error(
          `El precio de "${promo.titulo}" ($${Number(promo.precio)}) no alcanza el piso de $0,01 por unidad en el peor caso ` +
            `(${unidadesEnElPeorCaso} unidades si se elige el máximo de cada cupo: hace falta al menos $${minimoPrecio}). Subí el precio o bajá los máximos.`
        );
      }
    }

    await ctx.transaccion(async (tx) => {
      await tx.promoCartaCupo.deleteMany({ where: { promoCartaId } });
      if (cuposValidados.length) await tx.promoCartaCupo.createMany({ data: cuposValidados.map((c) => ({ promoCartaId, ...c })) });
    });

    return ok(
      cuposValidados.length
        ? `Cupos de "${promo.titulo}" guardados (${cuposValidados.length}): ahora es una promo armable en el POS.`
        : `"${promo.titulo}" volvió a ser informativa (sin cupos): el POS deja de ofrecerla para armar.`
    );
  });
}
