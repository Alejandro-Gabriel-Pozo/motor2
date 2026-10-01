"use server";

import type { Db } from "@/lib/db-tipos";
import { esErrorDeUnicidad, preciosLocalesVigentes } from "@/core/catalogo/public-servidor";
import { precioDeCarta } from "@/core/carta/armar-menu";
import { productoTieneDescuentoEnAlgunaSucursal } from "@/core/carta/descuento-producto-consulta";
import {
  normalizarTagsCarta,
  validarNombreItemAgrupadoCarta,
  validarOrdenCarta,
  validarTextoLibreCarta,
  LARGO_MAXIMO_DESCRIPCION_CARTA,
} from "@/core/carta/validaciones";
import { validarGeneroCartaOpcional } from "./generos-compartido";
import { conPermisoDeEmpresa } from "../con-permiso";
import { error, ok, okConId, type ResultadoAccion, type ResultadoConId } from "../tipos";
import { revalidarCartasPublicas } from "./revalidar";

/**
 * Ítems AGRUPADOS de la carta (docs/plan-agrupacion-items-carta-2026-09-24.md, M5): un renglón visible ("Gaseosa 500 CC") que
 * agrupa varios PV reales (Coca-Cola, Sprite, Fanta 500cc). Globales (Catálogo Central, D9). Solo escriben en `ItemAgrupadoCarta`
 * y `OpcionItemAgrupadoCarta`: el producto (nombre, precio, categoría, disponibilidad) y su `ContenidoCartaProducto` no se tocan.
 * Nunca se borra un ítem agrupado: se apaga. Quitar una opción borra solo la fila de referencia. Gate: `carta_items_agrupados` (empresa: los ítems agrupados son globales).
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

const pesos = (n: number) => `$${n.toLocaleString("es-AR")}`;

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

    if (!datos.seccionCartaId) return error("Elegí la sección de carta del ítem agrupado.");
    const seccion = await ctx.db.seccionCarta.findUnique({ where: { id: datos.seccionCartaId }, select: { id: true } });
    if (!seccion) return error("No se encontró la sección de carta.");
    const genero = await validarGeneroCartaOpcional(ctx.db, datos.generoCartaId);
    if (!genero.ok) return error(genero.mensaje);

    const repetido = await ctx.db.itemAgrupadoCarta.findFirst({
      where: { nombre: { equals: nombre.valor, mode: "insensitive" }, ...(datos.id ? { NOT: { id: datos.id } } : {}) },
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
        const existente = await ctx.db.itemAgrupadoCarta.findUnique({ where: { id: datos.id } });
        if (!existente) return error("No se encontró el ítem agrupado.");
        const editado = await ctx.db.itemAgrupadoCarta.update({ where: { id: datos.id }, data });
        revalidarCartasPublicas();
        return okConId(`Ítem agrupado "${editado.nombre}" guardado.`, editado.id, editado.nombre);
      }
      it = await ctx.db.itemAgrupadoCarta.create({ data });
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
      const r = await agregarOpcion(ctx.db, ctx.sucursalId, it.id, productoId, null);
      if (!r.ok) rechazos.push(r.mensaje);
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
    const existente = await ctx.db.itemAgrupadoCarta.findUnique({ where: { id: itemAgrupadoCartaId } });
    if (!existente) return error("No se encontró el ítem agrupado.");
    await ctx.db.itemAgrupadoCarta.update({ where: { id: itemAgrupadoCartaId }, data: { activo } });
    revalidarCartasPublicas();
    return ok(`Ítem agrupado "${existente.nombre}" ${activo ? "prendido" : "apagado"}.`);
  });
}

/** El mensaje cuando el producto ya está en un ítem agrupado (el mismo u otro): un producto va en a lo sumo uno (D2). */
async function mensajeYaAgrupado(db: Db, productoId: string, productoNombre: string, itemAgrupadoCartaId: string): Promise<string | null> {
  const ya = await db.opcionItemAgrupadoCarta.findFirst({ where: { productoId }, select: { itemAgrupadoCartaId: true, itemAgrupadoCarta: { select: { nombre: true } } } });
  if (!ya) return null;
  if (ya.itemAgrupadoCartaId === itemAgrupadoCartaId) return `«${productoNombre}» ya está en «${ya.itemAgrupadoCarta.nombre}».`;
  return `«${productoNombre}» ya está en «${ya.itemAgrupadoCarta.nombre}»: quitalo de ahí primero.`;
}

/**
 * Agrega un PV como opción de un ítem agrupado. BLOQUEA (D5) si su precio en la sucursal activa no coincide con el de TODAS las
 * opciones ya cargadas (calculado igual que la carta, `precioDeCarta`). El primer producto de un ítem sin opciones entra siempre.
 * La categoría del producto no importa: la opción sale (y sus ventas se cuentan) en la sección del ítem agrupado.
 */
export async function agregarOpcionItemAgrupadoCarta(itemAgrupadoCartaId: string, productoId: string, orden: number | string | null = null): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("carta_items_agrupados", (ctx) => agregarOpcion(ctx.db, ctx.sucursalId, itemAgrupadoCartaId, productoId, orden));
}

/**
 * El cuerpo de `agregarOpcionItemAgrupadoCarta`, SIN el gate (lo pone quien llama: esa acción, o `guardarItemAgrupadoCarta` en el
 * alta con productos, DA7). No se exporta: en un archivo "use server" todo lo exportado es un endpoint.
 */
async function agregarOpcion(db: Db, sucursalId: string, itemAgrupadoCartaId: string, productoId: string, orden: number | string | null): Promise<ResultadoAccion> {
  const item = await db.itemAgrupadoCarta.findUnique({
    where: { id: itemAgrupadoCartaId },
    select: {
      id: true,
      nombre: true,
      opciones: { select: { orden: true, producto: { select: { id: true, nombre: true, precioVenta: true } } } },
    },
  });
  if (!item) return error("No se encontró el ítem agrupado.");
  if (!productoId) return error("Elegí el producto a agregar.");
  const producto = await db.producto.findUnique({
    where: { id: productoId },
    select: { id: true, nombre: true, tipo: true, precioVenta: true },
  });
  if (!producto) return error("No se encontró el producto.");
  if (producto.tipo !== "PV") return error("Solo un producto de venta (PV) puede ir en la carta.");
  if (await productoTieneDescuentoEnAlgunaSucursal(producto.id, db)) return error(`«${producto.nombre}» tiene descuento en alguna sucursal: sacale el descuento para agruparlo (el renglón agrupado muestra un solo precio).`);

  const yaAgrupado = await mensajeYaAgrupado(db, producto.id, producto.nombre, item.id);
  if (yaAgrupado) return error(yaAgrupado);

  const o = validarOrdenCarta(orden ?? item.opciones.length);
  if (!o.ok) return error(o.mensaje);

  // D5: mismo precio que las opciones ya cargadas, en la sucursal activa de quien administra (con su precio local, si lo hay).
  if (item.opciones.length > 0) {
    const idsAComparar = [producto.id, ...item.opciones.map((op) => op.producto.id)];
    const localPorProducto = await preciosLocalesVigentes(sucursalId, db, idsAComparar);
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
    await db.opcionItemAgrupadoCarta.create({ data: { itemAgrupadoCartaId: item.id, productoId: producto.id, orden: o.valor } });
  } catch (e) {
    // Carrera: otro admin lo agregó a un grupo entre la verificación y el alta (`productoId` es único).
    if (esErrorDeUnicidad(e)) return error((await mensajeYaAgrupado(db, producto.id, producto.nombre, item.id)) ?? `«${producto.nombre}» ya está en un ítem agrupado.`);
    throw e;
  }
  revalidarCartasPublicas();
  return ok(`«${producto.nombre}» agregado a «${item.nombre}».`);
}

export async function actualizarOrdenOpcionItemAgrupadoCarta(opcionId: string, orden: number | string | null): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("carta_items_agrupados", async (ctx) => {
    const o = validarOrdenCarta(orden);
    if (!o.ok) return error(o.mensaje);
    const opcion = await ctx.db.opcionItemAgrupadoCarta.findUnique({ where: { id: opcionId }, select: { producto: { select: { nombre: true } } } });
    if (!opcion) return error("No se encontró la opción.");
    await ctx.db.opcionItemAgrupadoCarta.update({ where: { id: opcionId }, data: { orden: o.valor } });
    revalidarCartasPublicas();
    return ok(`Orden de «${opcion.producto.nombre}» guardado.`);
  });
}

/** Saca un producto de su ítem agrupado: se borra solo la referencia. El producto y su ContenidoCartaProducto no se tocan (D3). */
export async function quitarOpcionItemAgrupadoCarta(opcionId: string): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("carta_items_agrupados", async (ctx) => {
    const opcion = await ctx.db.opcionItemAgrupadoCarta.findUnique({
      where: { id: opcionId },
      select: { producto: { select: { nombre: true } }, itemAgrupadoCarta: { select: { nombre: true } } },
    });
    if (!opcion) return error("No se encontró la opción.");
    await ctx.db.opcionItemAgrupadoCarta.deleteMany({ where: { id: opcionId } });
    revalidarCartasPublicas();
    return ok(`«${opcion.producto.nombre}» ya no está en «${opcion.itemAgrupadoCarta.nombre}».`);
  });
}
