"use server";

import { prisma } from "@/lib/db";
import { esErrorDeUnicidad } from "@/core/catalogo/generar-codigo";
import { precioDeCarta } from "@/core/carta/armar-menu";
import {
  normalizarTagsCarta,
  validarImagenUrlCarta,
  validarNombreItemAgrupadoCarta,
  validarOrdenCarta,
  validarTextoLibreCarta,
  LARGO_MAXIMO_DESCRIPCION_CARTA,
} from "@/core/carta/validaciones";
import { conPermiso } from "../con-permiso";
import { error, ok, okConId, type ResultadoAccion, type ResultadoConId } from "../tipos";

/**
 * Ítems AGRUPADOS de la carta (docs/plan-agrupacion-items-carta-2026-09-24.md, M5): un renglón visible ("Gaseosa 500 CC") que
 * agrupa varios PV reales (Coca-Cola, Sprite, Fanta 500cc). Globales (Catálogo Central, D9). Solo escriben en `ItemAgrupadoCarta`
 * y `OpcionItemAgrupadoCarta`: el producto (nombre, precio, categoría, disponibilidad) y su `ContenidoCartaProducto` no se tocan.
 * Nunca se borra un ítem agrupado: se apaga. Quitar una opción borra solo la fila de referencia. Gate: `carta`.
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
  categoriaId: string;
  descripcion?: string | null;
  imagenUrl?: string | null;
  /** Lista, o texto separado por comas (como en la sheet). */
  tags?: readonly string[] | string | null;
  especial?: boolean;
  orden?: number | string | null;
}

const pesos = (n: number) => `$${n.toLocaleString("es-AR")}`;

export async function guardarItemAgrupadoCarta(datos: DatosItemAgrupadoCarta): Promise<ResultadoConId> {
  return conPermiso<ResultadoConId>("carta", async () => {
    const nombre = validarNombreItemAgrupadoCarta(datos.nombre);
    if (!nombre.ok) return error(nombre.mensaje);
    const descripcion = validarTextoLibreCarta(datos.descripcion, "La descripción", LARGO_MAXIMO_DESCRIPCION_CARTA);
    if (!descripcion.ok) return error(descripcion.mensaje);
    const imagenUrl = validarImagenUrlCarta(datos.imagenUrl);
    if (!imagenUrl.ok) return error(imagenUrl.mensaje);
    const tags = normalizarTagsCarta(datos.tags);
    if (!tags.ok) return error(tags.mensaje);
    const orden = validarOrdenCarta(datos.orden);
    if (!orden.ok) return error(orden.mensaje);

    if (!datos.categoriaId) return error("Elegí la categoría del ítem agrupado (es la que lo ubica en su sección de carta).");
    const categoria = await prisma.categoriaProducto.findUnique({ where: { id: datos.categoriaId }, select: { id: true } });
    if (!categoria) return error("No se encontró la categoría.");

    const repetido = await prisma.itemAgrupadoCarta.findFirst({
      where: { nombre: { equals: nombre.valor, mode: "insensitive" }, ...(datos.id ? { NOT: { id: datos.id } } : {}) },
    });
    if (repetido) return error(`Ya existe el ítem agrupado "${repetido.nombre}".`);

    const data = {
      nombre: nombre.valor,
      categoriaId: categoria.id,
      descripcion: descripcion.valor,
      imagenUrl: imagenUrl.valor,
      tags: tags.valor,
      especial: datos.especial === true,
      orden: orden.valor,
    };
    try {
      if (datos.id) {
        const existente = await prisma.itemAgrupadoCarta.findUnique({ where: { id: datos.id } });
        if (!existente) return error("No se encontró el ítem agrupado.");
        const it = await prisma.itemAgrupadoCarta.update({ where: { id: datos.id }, data });
        return okConId(`Ítem agrupado "${it.nombre}" guardado.`, it.id, it.nombre);
      }
      const it = await prisma.itemAgrupadoCarta.create({ data });
      return okConId(`Ítem agrupado "${it.nombre}" creado.`, it.id, it.nombre);
    } catch (e) {
      if (esErrorDeUnicidad(e)) return error(`Ya existe el ítem agrupado "${nombre.valor}".`);
      throw e;
    }
  });
}

/** Nunca se borra un ítem agrupado: se apaga (deja de salir en la carta, y sus opciones tampoco salen sueltas, D3). */
export async function actualizarActivoItemAgrupadoCarta(itemAgrupadoCartaId: string, activo: boolean): Promise<ResultadoAccion> {
  return conPermiso("carta", async () => {
    const existente = await prisma.itemAgrupadoCarta.findUnique({ where: { id: itemAgrupadoCartaId } });
    if (!existente) return error("No se encontró el ítem agrupado.");
    await prisma.itemAgrupadoCarta.update({ where: { id: itemAgrupadoCartaId }, data: { activo } });
    return ok(`Ítem agrupado "${existente.nombre}" ${activo ? "prendido" : "apagado"}.`);
  });
}

/** El mensaje cuando el producto ya está en un ítem agrupado (el mismo u otro): un producto va en a lo sumo uno (D2). */
async function mensajeYaAgrupado(productoId: string, productoNombre: string, itemAgrupadoCartaId: string): Promise<string | null> {
  const ya = await prisma.opcionItemAgrupadoCarta.findUnique({ where: { productoId }, select: { itemAgrupadoCartaId: true, itemAgrupadoCarta: { select: { nombre: true } } } });
  if (!ya) return null;
  if (ya.itemAgrupadoCartaId === itemAgrupadoCartaId) return `«${productoNombre}» ya está en «${ya.itemAgrupadoCarta.nombre}».`;
  return `«${productoNombre}» ya está en «${ya.itemAgrupadoCarta.nombre}»: quitalo de ahí primero.`;
}

/**
 * Agrega un PV como opción de un ítem agrupado. BLOQUEA (D5) si su precio en la sucursal activa no coincide con el de TODAS las
 * opciones ya cargadas (calculado igual que la carta, `precioDeCarta`). El primer producto de un ítem sin opciones entra siempre.
 * Si la categoría del producto cae en otra sección de carta que la del ítem agrupado, se agrega igual y se avisa (D4).
 */
export async function agregarOpcionItemAgrupadoCarta(itemAgrupadoCartaId: string, productoId: string, orden: number | string | null = null): Promise<ResultadoAccion> {
  return conPermiso("carta", async (ctx) => {
    const item = await prisma.itemAgrupadoCarta.findUnique({
      where: { id: itemAgrupadoCartaId },
      select: {
        id: true,
        nombre: true,
        categoria: { select: { seccionCarta: { select: { seccionCartaId: true, seccionCarta: { select: { nombre: true } } } } } },
        opciones: { select: { orden: true, producto: { select: { id: true, nombre: true, precioVenta: true } } } },
      },
    });
    if (!item) return error("No se encontró el ítem agrupado.");
    if (!productoId) return error("Elegí el producto a agregar.");
    const producto = await prisma.producto.findUnique({
      where: { id: productoId },
      select: {
        id: true,
        nombre: true,
        tipo: true,
        precioVenta: true,
        categoria: { select: { nombre: true, seccionCarta: { select: { seccionCartaId: true, seccionCarta: { select: { nombre: true } } } } } },
      },
    });
    if (!producto) return error("No se encontró el producto.");
    if (producto.tipo !== "PV") return error("Solo un producto de venta (PV) puede ir en la carta.");

    const yaAgrupado = await mensajeYaAgrupado(producto.id, producto.nombre, item.id);
    if (yaAgrupado) return error(yaAgrupado);

    const o = validarOrdenCarta(orden ?? item.opciones.length);
    if (!o.ok) return error(o.mensaje);

    // D5: mismo precio que las opciones ya cargadas, en la sucursal activa de quien administra (con su precio local, si lo hay).
    if (item.opciones.length > 0) {
      const idsAComparar = [producto.id, ...item.opciones.map((op) => op.producto.id)];
      const locales = await prisma.precioLocalProducto.findMany({
        where: { sucursalId: ctx.sucursalId, productoId: { in: idsAComparar } },
        select: { productoId: true, precio: true, habilitado: true },
      });
      const localPorProducto = new Map(locales.map((l) => [l.productoId, { precio: Number(l.precio), habilitado: l.habilitado }]));
      const precioCandidato = precioDeCarta(Number(producto.precioVenta), localPorProducto.get(producto.id));
      const preciosGrupo = item.opciones.map((op) => precioDeCarta(Number(op.producto.precioVenta), localPorProducto.get(op.producto.id)));
      if (preciosGrupo.some((p) => p !== precioCandidato)) {
        const minimo = Math.min(...preciosGrupo);
        const maximo = Math.max(...preciosGrupo);
        const delGrupo = minimo === maximo ? pesos(minimo) : `${pesos(minimo)} a ${pesos(maximo)}`;
        return error(
          `«${producto.nombre}» cuesta ${pesos(precioCandidato)} acá y «${item.nombre}» ya tiene opciones a ${delGrupo}: agrupá solo productos del mismo precio, o dejala aparte.`
        );
      }
    }

    try {
      await prisma.opcionItemAgrupadoCarta.create({ data: { itemAgrupadoCartaId: item.id, productoId: producto.id, orden: o.valor } });
    } catch (e) {
      // Carrera: otro admin lo agregó a un grupo entre la verificación y el alta (`productoId` es único).
      if (esErrorDeUnicidad(e)) return error((await mensajeYaAgrupado(producto.id, producto.nombre, item.id)) ?? `«${producto.nombre}» ya está en un ítem agrupado.`);
      throw e;
    }

    // D4: no se bloquea, se avisa. Las ventas de la opción se cuentan en la sección de SU categoría.
    const seccionItem = item.categoria.seccionCarta;
    const seccionProducto = producto.categoria?.seccionCarta;
    let aviso = "";
    if (seccionProducto?.seccionCartaId !== seccionItem?.seccionCartaId) {
      const donde = seccionProducto ? `la sección de carta «${seccionProducto.seccionCarta.nombre}»` : "ninguna sección de carta";
      const categoria = producto.categoria ? `su categoría «${producto.categoria.nombre}»` : "no tiene categoría y";
      aviso = ` Ojo: ${categoria} cae en ${donde}, no en la de «${item.nombre}»: en "Ventas por sección de carta" sus ventas se cuentan ahí.`;
    }
    return ok(`«${producto.nombre}» agregado a «${item.nombre}».${aviso}`);
  });
}

export async function actualizarOrdenOpcionItemAgrupadoCarta(opcionId: string, orden: number | string | null): Promise<ResultadoAccion> {
  return conPermiso("carta", async () => {
    const o = validarOrdenCarta(orden);
    if (!o.ok) return error(o.mensaje);
    const opcion = await prisma.opcionItemAgrupadoCarta.findUnique({ where: { id: opcionId }, select: { producto: { select: { nombre: true } } } });
    if (!opcion) return error("No se encontró la opción.");
    await prisma.opcionItemAgrupadoCarta.update({ where: { id: opcionId }, data: { orden: o.valor } });
    return ok(`Orden de «${opcion.producto.nombre}» guardado.`);
  });
}

/** Saca un producto de su ítem agrupado: se borra solo la referencia. El producto y su ContenidoCartaProducto no se tocan (D3). */
export async function quitarOpcionItemAgrupadoCarta(opcionId: string): Promise<ResultadoAccion> {
  return conPermiso("carta", async () => {
    const opcion = await prisma.opcionItemAgrupadoCarta.findUnique({
      where: { id: opcionId },
      select: { producto: { select: { nombre: true } }, itemAgrupadoCarta: { select: { nombre: true } } },
    });
    if (!opcion) return error("No se encontró la opción.");
    await prisma.opcionItemAgrupadoCarta.deleteMany({ where: { id: opcionId } });
    return ok(`«${opcion.producto.nombre}» ya no está en «${opcion.itemAgrupadoCarta.nombre}».`);
  });
}
