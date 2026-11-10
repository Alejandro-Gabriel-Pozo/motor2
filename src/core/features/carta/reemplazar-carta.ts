import { claveDeNombreDeCarta } from "@/core/carta/public";

/**
 * Lo PURO de «copiar / reemplazar la carta de otra sucursal» (pedido del dueño, 2026-11-10; diseño: `docs/diseno-reemplazar-carta-de-sucursal-2026-11-10.md`). Sin Prisma ni permisos:
 * el caso de uso lee las filas, las pasa por acá para decidir y para comparar, y escribe.
 *
 * «Carta propia» de una sucursal = sus géneros, ítems agrupados (con sus opciones) y contenidos de producto. Las secciones, promos, cupos y el tema son de la empresa y no entran.
 */

export interface GeneroDeCarta {
  id: string;
  nombre: string;
  orden: number;
  activo: boolean;
}

export interface OpcionDeItemAgrupado {
  productoId: string;
  orden: number;
}

export interface ItemAgrupadoDeCarta {
  nombre: string;
  seccionCartaId: string;
  descripcion: string | null;
  tags: string[];
  especial: boolean;
  orden: number;
  activo: boolean;
  generoCartaId: string | null;
  opciones: readonly OpcionDeItemAgrupado[];
}

export interface ContenidoDeCarta {
  productoId: string;
  visibleEnCarta: boolean;
  seccionCartaId: string | null;
  descripcion: string | null;
  tags: string[];
  especial: boolean;
  orden: number;
  generoCartaId: string | null;
  mostrarNombreArriba: boolean;
  nombreEnCarta: string | null;
}

/** Lo que se copia o se reemplaza: la carta propia de UNA sucursal, tal como se lee. */
export interface CartaDeSucursal {
  generos: readonly GeneroDeCarta[];
  items: readonly ItemAgrupadoDeCarta[];
  contenidos: readonly ContenidoDeCarta[];
}

export interface CuentaDeCarta {
  productos: number;
  itemsAgrupados: number;
  generos: number;
}

export const cuentaDeCarta = (c: CartaDeSucursal): CuentaDeCarta => ({ productos: c.contenidos.length, itemsAgrupados: c.items.length, generos: c.generos.length });

/** ¿Tiene algo propio? (un contenido, un género o un ítem agrupado). */
export const cartaTieneAlgo = (c: CartaDeSucursal): boolean => c.contenidos.length + c.items.length + c.generos.length > 0;

/**
 * La carta tal como QUEDA en el destino al copiarla: regla del dueño (2026-11-04), el «Nombre en la carta» de un contenido que choca con el título de una promo del destino NO se copia
 * (el plato sale con el nombre de su producto). `titulosDePromo` son las CLAVES (`claveDeNombreDeCarta`) de las promos del destino.
 */
export function cartaCopiadaPara(origen: CartaDeSucursal, titulosDePromo: ReadonlySet<string>): { carta: CartaDeSucursal; sinCopiarElNombre: ContenidoDeCarta[] } {
  const sinCopiarElNombre = origen.contenidos.filter((c) => c.nombreEnCarta !== null && titulosDePromo.has(claveDeNombreDeCarta(c.nombreEnCarta)));
  const sinNombre = new Set(sinCopiarElNombre);
  return { carta: { ...origen, contenidos: origen.contenidos.map((c) => (sinNombre.has(c) ? { ...c, nombreEnCarta: null } : c)) }, sinCopiarElNombre };
}

const porTexto = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * La FIRMA de una carta: un texto que no depende de los ids de las filas (los géneros se nombran por su nombre, único en la sucursal; los ítems agrupados por su nombre, único en la sucursal;
 * los contenidos y las opciones por su producto, único en la sucursal) ni del orden de lectura. Dos cartas con la misma firma se ven igual en la carta pública, el POS y la administración.
 */
export function firmaDeCarta(c: CartaDeSucursal): string {
  const nombreDeGenero = new Map(c.generos.map((g) => [g.id, g.nombre]));
  const genero = (id: string | null) => (id === null ? null : (nombreDeGenero.get(id) ?? null));
  const generos = c.generos.map((g) => [g.nombre, g.orden, g.activo]).sort((a, b) => porTexto(String(a[0]), String(b[0])));
  const items = c.items
    .map((i) => [i.nombre, i.seccionCartaId, i.descripcion, i.tags, i.especial, i.orden, i.activo, genero(i.generoCartaId), [...i.opciones].map((o) => [o.productoId, o.orden]).sort((a, b) => porTexto(String(a[0]), String(b[0])))])
    .sort((a, b) => porTexto(String(a[0]), String(b[0])));
  const contenidos = c.contenidos
    .map((k) => [k.productoId, k.visibleEnCarta, k.seccionCartaId, k.descripcion, k.tags, k.especial, k.orden, genero(k.generoCartaId), k.mostrarNombreArriba, k.nombreEnCarta])
    .sort((a, b) => porTexto(String(a[0]), String(b[0])));
  return JSON.stringify({ generos, items, contenidos });
}

export type ModoDeCopiaDeCarta = "COPIAR" | "REEMPLAZAR";

/**
 * La decisión del caso de uso, ANTES de escribir nada. `sonIguales` solo importa en REEMPLAZAR con un destino que ya tiene carta (la firma del destino es la que quedaría al copiar).
 *  - COPIAR (la copia de siempre): un destino con carta rechaza («solo sobre una carta vacía»; gana sobre «el origen no tiene nada»); si no, un origen sin carta rechaza.
 *  - REEMPLAZAR: un origen sin carta rechaza SIN tocar nada; un destino ya igual no cambia (idempotente); si no, aplica (con un destino vacío es una copia: no hay nada que eliminar).
 */
export type DecisionDeCopiaDeCarta = "CARTA_PROPIA_EXISTENTE" | "ORIGEN_SIN_CARTA" | "SIN_CAMBIO" | "APLICAR";

export function decidirCopiaDeCarta(e: { modo: ModoDeCopiaDeCarta; destinoTieneCarta: boolean; origenTieneCarta: boolean; sonIguales: boolean }): DecisionDeCopiaDeCarta {
  if (e.modo === "COPIAR") {
    if (e.destinoTieneCarta) return "CARTA_PROPIA_EXISTENTE";
    return e.origenTieneCarta ? "APLICAR" : "ORIGEN_SIN_CARTA";
  }
  if (!e.origenTieneCarta) return "ORIGEN_SIN_CARTA";
  if (e.destinoTieneCarta && e.sonIguales) return "SIN_CAMBIO";
  return "APLICAR";
}

/**
 * La FOTO de lo que se elimina, para la auditoría (JSON, un solo texto): alcanza para reconstruir a mano la carta del destino (cada género, ítem agrupado con sus opciones y contenido con todos sus
 * campos; los productos con su nombre además del id). Sin dinero. Determinista (mismo orden siempre) para que dos fotos de la misma carta sean iguales.
 */
export function fotoDeCartaEliminada(c: CartaDeSucursal, nombreDeProducto: ReadonlyMap<string, string>): string {
  const nombre = (id: string) => nombreDeProducto.get(id) ?? null;
  const nombreDeGenero = new Map(c.generos.map((g) => [g.id, g.nombre]));
  const genero = (id: string | null) => (id === null ? null : (nombreDeGenero.get(id) ?? null));
  return JSON.stringify({
    generos: [...c.generos].sort((a, b) => porTexto(a.nombre, b.nombre)).map((g) => ({ nombre: g.nombre, orden: g.orden, activo: g.activo })),
    itemsAgrupados: [...c.items]
      .sort((a, b) => porTexto(a.nombre, b.nombre))
      .map((i) => ({
        nombre: i.nombre,
        seccionCartaId: i.seccionCartaId,
        descripcion: i.descripcion,
        tags: i.tags,
        especial: i.especial,
        orden: i.orden,
        activo: i.activo,
        genero: genero(i.generoCartaId),
        opciones: [...i.opciones].sort((a, b) => porTexto(a.productoId, b.productoId)).map((o) => ({ productoId: o.productoId, producto: nombre(o.productoId), orden: o.orden })),
      })),
    productos: [...c.contenidos]
      .sort((a, b) => porTexto(a.productoId, b.productoId))
      .map((k) => ({
        productoId: k.productoId,
        producto: nombre(k.productoId),
        visibleEnCarta: k.visibleEnCarta,
        seccionCartaId: k.seccionCartaId,
        descripcion: k.descripcion,
        tags: k.tags,
        especial: k.especial,
        orden: k.orden,
        genero: genero(k.generoCartaId),
        mostrarNombreArriba: k.mostrarNombreArriba,
        nombreEnCarta: k.nombreEnCarta,
      })),
  });
}
