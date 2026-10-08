"use server";

import { esErrorDeUnicidad } from "@/core/catalogo/public-servidor";
import {
  normalizarTagsCarta,
  validarNombreItemAgrupadoCarta,
  validarOrdenCarta,
  validarTextoLibreCarta,
  LARGO_MAXIMO_DESCRIPCION_CARTA,
} from "@/core/carta/validaciones";
import { MAXIMO_PRODUCTOS_POR_ITEM_AGRUPADO, validarTopeDeLista } from "@/core/datos/limites";
import { whereCartaDeSucursal } from "@/core/carta/public";
import { guardComandoActualizarOrdenOpcionItemAgrupadoCarta } from "@/core/features/carta/items-agrupados.guard";
import { aResultadoAccion } from "@/core/resultado-caso";
import { validarGeneroCartaOpcional } from "./generos-compartido";
import { conPermisoDeEmpresa } from "../con-permiso";
import { error, okConId, type ResultadoAccion, type ResultadoConId } from "../tipos";
import { actualizarActivoItemAgrupadoCartaCasoDeUso } from "./casos-de-uso/actualizar-activo-item-agrupado-carta";
import { agregarOpcionItemAgrupadoCartaCasoDeUso } from "./casos-de-uso/agregar-opcion-item-agrupado-carta";
import { actualizarOrdenOpcionItemAgrupadoCartaCasoDeUso } from "./casos-de-uso/actualizar-orden-opcion-item-agrupado-carta";
import { quitarOpcionItemAgrupadoCartaCasoDeUso } from "./casos-de-uso/quitar-opcion-item-agrupado-carta";
import { revalidarCartasPublicas } from "./revalidar";

/**
 * Ítems AGRUPADOS de la carta (docs/plan-agrupacion-items-carta-2026-09-24.md, M5): un renglón visible ("Gaseosa 500 CC") que
 * agrupa varios PV reales (Coca-Cola, Sprite, Fanta 500cc). PROPIOS de cada sucursal (ADR-009, C3): se crean y se editan siempre en la
 * sucursal activa; la sección donde se ubican sí es de la empresa. Solo escriben en `ItemAgrupadoCarta`
 * y `OpcionItemAgrupadoCarta`: el producto (nombre, precio, categoría, disponibilidad) y su `ContenidoCartaProducto` no se tocan.
 * Nunca se borra un ítem agrupado: se apaga. Quitar una opción borra solo la fila de referencia. Gate: `carta_items_agrupados`.
 *
 * UBICACIÓN (docs/plan-carta-seccion-directa-2026-09-25.md): el ítem agrupado elige su sección de carta DIRECTO, sin Categoría
 * de producto de por medio, y no tiene imagen propia (la carta solo dibuja la de la sección).
 *
 * PRECIO (D5, decisión del dueño): el ítem agrupado no tiene precio propio y solo se agrupan productos del MISMO precio. Por eso
 * `agregarOpcionItemAgrupadoCarta` BLOQUEA una opción cuyo precio (con `precioDeCarta`, en la sucursal activa de quien administra)
 * no coincide con el de las opciones ya cargadas. Si el precio de una opción cambia DESPUÉS en Catálogo o en Precio Local, la carta
 * muestra el mayor y la pantalla avisa (red de seguridad de `armarMenuCarta`), porque eso no se puede bloquear desde acá.
 */

export interface DatosItemAgrupadoCarta {
  /** Sin id = alta; con id = edición. */
  id?: string;
  nombre: string;
  /** La sección de carta donde se ubica (obligatoria). */
  seccionCartaId: string;
  descripcion?: string | null;
  /** Lista, o texto separado por comas (separado por comas). */
  tags?: readonly string[] | string | null;
  especial?: boolean;
  orden?: number | string | null;
  /**
   * Carpeta de género del POS (docs/plan-genero-carta-2026-09-26.md), OPCIONAL: vacío/null = sin género (sale suelto). Las
   * opciones del ítem agrupado heredan este género: nunca tienen uno propio.
   */
  generoCartaId?: string | null;
  /**
   * SOLO en el alta (DA7, docs/plan-carta-seccion-directa-2026-09-25.md): productos a agregar como opciones apenas se crea el ítem,
   * en este orden y con la MISMA validación que `agregarOpcionItemAgrupadoCarta` (PV, que no esté en otro grupo, mismo precio D5).
   * Los que no entran no frenan el alta: el mensaje final dice cuáles y por qué. Al editar se ignora (para sumar opciones a un
   * ítem existente está "Agregar producto").
   */
  productoIds?: readonly string[] | null;
}

export async function guardarItemAgrupadoCarta(datos: DatosItemAgrupadoCarta): Promise<ResultadoConId> {
  return conPermisoDeEmpresa<ResultadoConId>("carta_items_agrupados", async (ctx) => {
    const nombre = validarNombreItemAgrupadoCarta(datos.nombre);
    if (!nombre.ok) return error(nombre.mensaje);
    const descripcion = validarTextoLibreCarta(datos.descripcion, "La descripción", LARGO_MAXIMO_DESCRIPCION_CARTA);
    if (!descripcion.ok) return error(descripcion.mensaje);
    const tags = normalizarTagsCarta(datos.tags);
    if (!tags.ok) return error(tags.mensaje);
    const orden = validarOrdenCarta(datos.orden);
    if (!orden.ok) return error(orden.mensaje);
    const excedeProductos = validarTopeDeLista(datos.productoIds ?? [], "Los productos", MAXIMO_PRODUCTOS_POR_ITEM_AGRUPADO);
    if (excedeProductos) return error(excedeProductos);

    if (!datos.seccionCartaId) return error("Elegí la sección de carta del ítem agrupado.");
    const seccion = await ctx.db.seccionCarta.findUnique({ where: { id: datos.seccionCartaId }, select: { id: true } });
    if (!seccion) return error("No se encontró la sección de carta.");
    const genero = await validarGeneroCartaOpcional(ctx.db, ctx.sucursalId, datos.generoCartaId);
    if (!genero.ok) return error(genero.mensaje);

    const repetido = await ctx.db.itemAgrupadoCarta.findFirst({
      where: { nombre: { equals: nombre.valor, mode: "insensitive" }, ...whereCartaDeSucursal(ctx.sucursalId), ...(datos.id ? { NOT: { id: datos.id } } : {}) },
    });
    if (repetido) return error(`Ya existe el ítem agrupado "${repetido.nombre}".`);

    const data = {
      nombre: nombre.valor,
      seccionCartaId: seccion.id,
      descripcion: descripcion.valor,
      tags: tags.valor,
      especial: datos.especial === true,
      orden: orden.valor,
      generoCartaId: genero.valor,
    };
    let it: { id: string; nombre: string };
    try {
      if (datos.id) {
        const existente = await ctx.db.itemAgrupadoCarta.findUnique({ where: { id: datos.id, ...whereCartaDeSucursal(ctx.sucursalId) } });
        if (!existente) return error("No se encontró el ítem agrupado.");
        const editado = await ctx.db.itemAgrupadoCarta.update({ where: { id: datos.id }, data });
        revalidarCartasPublicas();
        return okConId(`Ítem agrupado "${editado.nombre}" guardado.`, editado.id, editado.nombre);
      }
      it = await ctx.db.itemAgrupadoCarta.create({ data: { sucursalId: ctx.sucursalId, ...data } });
    } catch (e) {
      if (esErrorDeUnicidad(e)) return error(`Ya existe el ítem agrupado "${nombre.valor}".`);
      throw e;
    }

    revalidarCartasPublicas();
    const productoIds = [...new Set((datos.productoIds ?? []).map((id) => id.trim()).filter(Boolean))];
    if (productoIds.length === 0) return okConId(`Ítem agrupado "${it.nombre}" creado.`, it.id, it.nombre);

    // DA7: de a uno, en el orden recibido, con la misma validación que "Agregar producto" (cada uno se compara con los que ya
    // entraron). Un rechazo no frena a los demás ni deshace el alta: se junta todo en un solo mensaje.
    const rechazos: string[] = [];
    for (const productoId of productoIds) {
      const r = aResultadoAccion(await agregarOpcionItemAgrupadoCartaCasoDeUso(ctx, { itemAgrupadoCartaId: it.id, productoId, orden: null }));
      if (r.ok) revalidarCartasPublicas();
      else rechazos.push(r.mensaje);
    }
    const entraron = productoIds.length - rechazos.length;
    const resumen = `Ítem agrupado "${it.nombre}" creado con ${entraron} de ${productoIds.length} producto${productoIds.length === 1 ? "" : "s"}.`;
    const detalle = rechazos.length ? ` ${rechazos.length === 1 ? "No entró" : "No entraron"}: ${rechazos.join(" ")}` : "";
    return okConId(`${resumen}${detalle}`, it.id, it.nombre);
  });
}

/** Nunca se borra un ítem agrupado: se apaga (deja de salir en la carta, y sus opciones tampoco salen sueltas, D3). */
export async function actualizarActivoItemAgrupadoCarta(itemAgrupadoCartaId: string, activo: boolean): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("carta_items_agrupados", async (ctx) => {
    const resultado = await actualizarActivoItemAgrupadoCartaCasoDeUso(ctx, { itemAgrupadoCartaId, activo });
    if (resultado.ok) revalidarCartasPublicas();
    return aResultadoAccion(resultado);
  });
}

/**
 * Agrega un PV como opción de un ítem agrupado. BLOQUEA (D5) si su precio en la sucursal activa no coincide con el de TODAS las
 * opciones ya cargadas (calculado igual que la carta, `precioDeCarta`). El primer producto de un ítem sin opciones entra siempre.
 * La categoría del producto no importa: la opción sale (y sus ventas se cuentan) en la sección del ítem agrupado. Permiso → caso de uso
 * (`casos-de-uso/agregar-opcion-item-agrupado-carta.ts`) → revalidar si salió bien → `aResultadoAccion`. Sin guard (`SIN_GUARD`).
 */
export async function agregarOpcionItemAgrupadoCarta(itemAgrupadoCartaId: string, productoId: string, orden: number | string | null = null): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("carta_items_agrupados", async (ctx) => {
    const resultado = await agregarOpcionItemAgrupadoCartaCasoDeUso(ctx, { itemAgrupadoCartaId, productoId, orden });
    if (resultado.ok) revalidarCartasPublicas();
    return aResultadoAccion(resultado);
  });
}

export async function actualizarOrdenOpcionItemAgrupadoCarta(opcionId: string, orden: number | string | null): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("carta_items_agrupados", async (ctx) => {
    const comando = guardComandoActualizarOrdenOpcionItemAgrupadoCarta({ opcionId, orden });
    if (!comando.ok) return error(comando.mensaje);
    const resultado = await actualizarOrdenOpcionItemAgrupadoCartaCasoDeUso(ctx, comando.valor);
    if (resultado.ok) revalidarCartasPublicas();
    return aResultadoAccion(resultado);
  });
}

/** Saca un producto de su ítem agrupado: se borra solo la referencia. El producto y su ContenidoCartaProducto no se tocan (D3). */
export async function quitarOpcionItemAgrupadoCarta(opcionId: string): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("carta_items_agrupados", async (ctx) => {
    const resultado = await quitarOpcionItemAgrupadoCartaCasoDeUso(ctx, { opcionId });
    if (resultado.ok) revalidarCartasPublicas();
    return aResultadoAccion(resultado);
  });
}
