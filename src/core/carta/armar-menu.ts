/**
 * Carta pública (docs/plan-carta-catalogo-2026-09-24.md, M2): arma la carta pública (`CartaV1`) a partir de
 * datos ya leídos. Lógica PURA, sin Prisma — mismo criterio que `disponibilidad-producto.ts` / `-consulta.ts`: la lectura
 * vive en `menu-consulta.ts`, un archivo aparte, para que un "use client" que importe un valor de acá (p. ej.
 * `urlImagenSegura` desde la pantalla de admin) nunca arrastre `@/lib/db` al bundle del cliente.
 *
 * Qué decide este módulo (y ningún otro):
 *  - el PRECIO que muestra la carta: el mismo que se cobra (`precioDeCarta`, paridad con `resolverPrecioVenta`);
 *  - cómo se ubican los PV y los ítems agrupados en las secciones de carta: DIRECTO, cada uno por su `seccionCartaId`
 *    (docs/plan-carta-seccion-directa-2026-09-25.md) — la Categoría de producto no tiene ningún papel en la carta;
 *  - cómo se arma un ÍTEM AGRUPADO ("Gaseosa 500cc" → Coca-Cola, Sprite, Fanta; docs/plan-agrupacion-items-carta-2026-09-24.md):
 *    su precio (el de sus opciones; si difieren, el MAYOR, D5) y que un producto agrupado nunca salga suelto (D3);
 *  - el ORDEN de secciones, ítems y promos (dentro de una sección: `orden` → nombre, sueltos y agrupados en la misma escala);
 *  - qué `imagenUrl` de SECCIÓN es segura para la carta (`urlImagenSegura`). Un ítem no tiene imagen propia: la carta pública
 *    solo dibuja la de la sección, así que `ItemCartaV1.imagenUrl` sale siempre `null`.
 *
 * Qué NO decide: qué PV están disponibles en la sucursal ni cuáles son visibles en la carta — eso ya viene filtrado desde la
 * consulta (`whereDisponibleEn` + `ContenidoCartaProducto.visibleEnCarta`).
 */

// ---------------------------------------------------------------------------------------------------------------------
// Contrato público v1 (lo que viaja a restaurant-menu-design). Cambiar una forma = subir `version`.
// ---------------------------------------------------------------------------------------------------------------------

import { aplicarDescuentoDeProducto } from "./descuento-producto";

export interface ItemCartaV1 {
  productoId: string;
  nombre: string;
  /**
   * Informativo (restaurant-menu-design no lo dibuja; solo exige un texto no vacío): de un PV suelto, el nombre de su
   * CategoriaProducto (p. ej. "Bife"), o el de su sección si no tiene categoría; de un ítem agrupado, el nombre de su sección.
   */
  categoria: string;
  descripcion: string | null;
  /**
   * Precio final en pesos, numérico: el local habilitado de la sucursal o, si no, el precio de venta global — y, si el producto tiene descuento
   * en esta sucursal, ya con el descuento aplicado (lo que se cobra).
   */
  precio: number;
  /**
   * SOLO en un PV suelto con descuento en la sucursal (producto con descuento, 2026-10-01): el precio sin descuento (para mostrarlo tachado).
   * Un ítem sin descuento no lleva esta clave ni `descuentoPorcentaje`: su JSON queda igual que antes. Campo aditivo de la v1: `version` no cambia.
   */
  precioLista?: number;
  /** SOLO junto a `precioLista`: el % de descuento aplicado. */
  descuentoPorcentaje?: number;
  tags: string[];
  especial: boolean;
  /**
   * SIEMPRE `null` (docs/plan-carta-seccion-directa-2026-09-25.md): un ítem no tiene imagen propia, la carta pública solo usa la
   * de la sección. La clave se mantiene porque la guardia de forma de restaurant-menu-design la exige.
   */
  imagenUrl: null;
  /**
   * SOLO en un ítem AGRUPADO (docs/plan-agrupacion-items-carta-2026-09-24.md, D6): los PV reales que agrupa, disponibles en la
   * sucursal y en su orden. En un ítem agrupado, `productoId` es el id del ítem agrupado (no de un Producto), `nombre`,
   * `descripcion`, `tags` y `especial` son los del ítem agrupado, y `precio` es el de sus opciones (el mayor, si
   * llegaran a diferir). Un ítem SIN agrupar no lleva esta clave (ni siquiera vacía): su JSON queda igual que antes. Campo aditivo
   * de la v1: `version` no cambia.
   */
  opciones?: OpcionItemCartaV1[];
}

/** Una opción (un PV real) dentro de un ítem agrupado de la carta. */
export interface OpcionItemCartaV1 {
  productoId: string;
  nombre: string;
  /** Precio final en pesos, con la misma regla que un ítem suelto (`precioDeCarta`). */
  precio: number;
}

export interface PromoCartaV1 {
  id: string;
  titulo: string;
  descripcion: string | null;
  precio: number;
  orden: number;
}

export interface SeccionCartaV1 {
  id: string;
  /** "Platos Principales" — en la carta, `MenuCategory.label`. */
  nombre: string;
  /** "Del fuego" — null = la carta usa `nombre`. */
  titulo: string | null;
  descripcion: string | null;
  imagenUrl: string | null;
  orden: number;
  items: ItemCartaV1[];
  promos: PromoCartaV1[];
}

export interface CartaV1 {
  version: 1;
  /** ISO 8601. */
  generadoEn: string;
  sucursal: { id: string; nombre: string };
  secciones: SeccionCartaV1[];
}

// ---------------------------------------------------------------------------------------------------------------------
// Entrada (ya leída de la base por menu-consulta.ts, con los Decimal pasados a number)
// ---------------------------------------------------------------------------------------------------------------------

export interface SeccionCartaEntrada {
  id: string;
  nombre: string;
  titulo: string | null;
  descripcion: string | null;
  imagenUrl: string | null;
  orden: number;
}

export interface ContenidoCartaEntrada {
  descripcion: string | null;
  tags: readonly string[];
  especial: boolean;
  orden: number;
}

export interface ProductoCartaEntrada {
  id: string;
  nombre: string;
  precioVenta: number;
  /** Solo informativo (`ItemCartaV1.categoria`): no ubica nada. */
  categoriaNombre: string | null;
  /** La sección de carta donde se ubica (la de su ContenidoCartaProducto), o null. */
  seccionCartaId: string | null;
  contenido: ContenidoCartaEntrada;
}

export interface PrecioLocalEntrada {
  productoId: string;
  precio: number;
  habilitado: boolean;
}

export interface PromoCartaEntrada {
  id: string;
  seccionCartaId: string;
  titulo: string;
  descripcion: string | null;
  precio: number;
  orden: number;
}

export interface EntradaArmarMenu {
  sucursal: { id: string; nombre: string };
  generadoEn: Date;
  /** Solo las secciones ACTIVAS. */
  secciones: readonly SeccionCartaEntrada[];
  /** PV ya filtrados: disponibles en la sucursal y con `visibleEnCarta`. */
  productos: readonly ProductoCartaEntrada[];
  /** Precios locales de la sucursal (puede incluir deshabilitados: los ignora `precioDeCarta`). */
  preciosLocales: readonly PrecioLocalEntrada[];
  /** % de descuento de los productos en la sucursal (opcional: sin descuentos, la carta sale exactamente igual que antes). */
  descuentos?: readonly { productoId: string; porcentaje: number }[];
  /** Promos activas de la sucursal. */
  promos: readonly PromoCartaEntrada[];
  /** Ítems agrupados ACTIVOS (opcional: sin agrupados, la carta sale exactamente igual que antes). */
  agrupados?: readonly ItemAgrupadoEntrada[];
}

export interface OpcionAgrupadoEntrada {
  productoId: string;
  nombre: string;
  precioVenta: number;
  orden: number;
}

export interface ItemAgrupadoEntrada {
  id: string;
  nombre: string;
  /** La sección de carta donde se ubica, directo. */
  seccionCartaId: string;
  /** Lo de cara al cliente del ítem agrupado (misma forma que el contenido de un PV). */
  contenido: ContenidoCartaEntrada;
  /** Ya filtradas: solo PV disponibles en la sucursal. */
  opciones: readonly OpcionAgrupadoEntrada[];
}

export interface ProductoSinSeccion {
  productoId: string;
  nombre: string;
}

export interface AgrupadoSinSeccion {
  id: string;
  nombre: string;
}

export interface AgrupadoConPreciosDistintos {
  id: string;
  nombre: string;
  minimo: number;
  maximo: number;
}

export interface MenuArmado {
  carta: CartaV1;
  /** Solo para uso interno (admin/logs): el endpoint NO lo expone. */
  diagnostico: {
    /** PV disponibles y visibles que no aparecen porque no tienen sección de carta, o la suya está apagada. */
    visiblesSinSeccion: ProductoSinSeccion[];
    /** Ítems agrupados con opciones que no salen porque su sección de carta está apagada. */
    agrupadosSinSeccion: AgrupadoSinSeccion[];
    /** Ítems agrupados sin ninguna opción disponible en la sucursal (no salen). */
    agrupadosSinOpciones: { id: string; nombre: string }[];
    /**
     * Ítems agrupados cuyas opciones NO cuestan lo mismo en la sucursal (D5): la carta muestra el máximo. En el camino normal no
     * pasa (agregar una opción de otro precio se bloquea); es la red de seguridad para un cambio de precio posterior en Catálogo.
     */
    agrupadosConPreciosDistintos: AgrupadoConPreciosDistintos[];
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Reglas
// ---------------------------------------------------------------------------------------------------------------------

/**
 * El precio que muestra la carta = el que se cobra. MISMA regla que `resolverPrecioVenta` (src/server/lecturas/
 * movimientos/precio-venta.ts, port de resolverPrecioVenta_ de Catalogo.js): el Precio Local si está cargado Y habilitado, si no el
 * precio de venta global. Fijado por un test de paridad en test/carta/armar-menu.test.ts.
 */
export function precioDeCarta(precioVenta: number, local: { precio: number; habilitado: boolean } | null | undefined): number {
  return local?.habilitado ? local.precio : precioVenta;
}

/**
 * La carta mete la URL en `backgroundImage: url(${url})` sin escapar (restaurant-menu-design,
 * components/carta-section-image.tsx): una comilla, un paréntesis o un espacio rompen ese CSS o lo dejan inyectable. Solo
 * pasa `https://` con un host, sin espacios, comillas, paréntesis, barras invertidas ni `<>`; cualquier otra cosa → null.
 */
export function urlImagenSegura(url: string | null | undefined): string | null {
  if (!url) return null;
  const u = url.trim();
  if (!/^https:\/\/[^\s"'()\\<>`]+$/i.test(u)) return null;
  try {
    const parsed = new URL(u);
    if (parsed.protocol !== "https:" || !parsed.hostname) return null;
  } catch {
    return null;
  }
  return u;
}

function textoONull(s: string | null | undefined): string | null {
  const t = s?.trim();
  return t ? t : null;
}

function limpiarTags(tags: readonly string[]): string[] {
  const vistos = new Set<string>();
  const salida: string[] = [];
  for (const tag of tags) {
    const t = tag.trim();
    if (!t || vistos.has(t)) continue;
    vistos.add(t);
    salida.push(t);
  }
  return salida;
}

const comparar = (a: string, b: string) => a.localeCompare(b, "es");

// ---------------------------------------------------------------------------------------------------------------------
// Armado
// ---------------------------------------------------------------------------------------------------------------------

export function armarMenuCarta(entrada: EntradaArmarMenu): MenuArmado {
  const precioLocalPorProducto = new Map(entrada.preciosLocales.map((pl) => [pl.productoId, pl]));
  const descuentoPorProducto = new Map((entrada.descuentos ?? []).map((d) => [d.productoId, d.porcentaje]));
  // Solo llegan las secciones ACTIVAS: un seccionCartaId que no está acá es de una sección apagada (o no tiene).
  const nombreDeSeccion = new Map(entrada.secciones.map((s) => [s.id, s.nombre]));

  type ItemConOrden = { item: ItemCartaV1; orden: number };
  const itemsPorSeccion = new Map<string, ItemConOrden[]>();
  const ubicar = (seccionId: string, item: ItemCartaV1, orden: number) => {
    const lista = itemsPorSeccion.get(seccionId) ?? [];
    lista.push({ item, orden });
    itemsPorSeccion.set(seccionId, lista);
  };
  const visiblesSinSeccion: ProductoSinSeccion[] = [];
  const agrupados = entrada.agrupados ?? [];

  // D3 (defensa): un producto que es opción de un ítem agrupado sale SOLO dentro del grupo, aunque venga también como suelto
  // (la consulta ya lo excluye; esto cubre cualquier entrada que no lo haga).
  const productosAgrupados = new Set(agrupados.flatMap((ag) => ag.opciones.map((o) => o.productoId)));

  for (const p of entrada.productos) {
    if (productosAgrupados.has(p.id)) continue;
    const seccionNombre = p.seccionCartaId ? nombreDeSeccion.get(p.seccionCartaId) : undefined;
    if (!p.seccionCartaId || seccionNombre === undefined) {
      visiblesSinSeccion.push({ productoId: p.id, nombre: p.nombre });
      continue;
    }
    const conDescuento = aplicarDescuentoDeProducto(precioDeCarta(p.precioVenta, precioLocalPorProducto.get(p.id)), descuentoPorProducto.get(p.id));
    ubicar(
      p.seccionCartaId,
      {
        productoId: p.id,
        nombre: p.nombre,
        categoria: textoONull(p.categoriaNombre) ?? seccionNombre,
        descripcion: textoONull(p.contenido.descripcion),
        precio: conDescuento.precio,
        ...(conDescuento.precioLista !== null ? { precioLista: conDescuento.precioLista, descuentoPorcentaje: conDescuento.porcentaje! } : {}),
        tags: limpiarTags(p.contenido.tags),
        especial: p.contenido.especial,
        imagenUrl: null,
      },
      p.contenido.orden
    );
  }

  const agrupadosSinSeccion: AgrupadoSinSeccion[] = [];
  const agrupadosSinOpciones: { id: string; nombre: string }[] = [];
  const agrupadosConPreciosDistintos: AgrupadoConPreciosDistintos[] = [];

  for (const ag of agrupados) {
    if (ag.opciones.length === 0) {
      agrupadosSinOpciones.push({ id: ag.id, nombre: ag.nombre });
      continue;
    }
    const seccionNombre = nombreDeSeccion.get(ag.seccionCartaId);
    if (seccionNombre === undefined) {
      agrupadosSinSeccion.push({ id: ag.id, nombre: ag.nombre });
      continue;
    }
    const opciones: OpcionItemCartaV1[] = [...ag.opciones]
      .sort((a, b) => a.orden - b.orden || comparar(a.nombre, b.nombre))
      .map((o) => ({ productoId: o.productoId, nombre: o.nombre, precio: precioDeCarta(o.precioVenta, precioLocalPorProducto.get(o.productoId)) }));
    const precios = opciones.map((o) => o.precio);
    const minimo = Math.min(...precios);
    const maximo = Math.max(...precios);
    // D5: en el camino normal no difieren (agregar una opción de otro precio se bloquea). Si un precio cambió DESPUÉS en Catálogo,
    // se muestra el MAYOR (nadie paga más de lo que vio en la carta) y el admin lo avisa.
    if (minimo !== maximo) agrupadosConPreciosDistintos.push({ id: ag.id, nombre: ag.nombre, minimo, maximo });
    ubicar(
      ag.seccionCartaId,
      {
        productoId: ag.id,
        nombre: ag.nombre,
        // Un ítem agrupado no tiene categoría: lleva el nombre de su sección (texto no vacío, lo que exige la guardia de forma).
        categoria: seccionNombre,
        descripcion: textoONull(ag.contenido.descripcion),
        precio: maximo,
        tags: limpiarTags(ag.contenido.tags),
        especial: ag.contenido.especial,
        imagenUrl: null,
        opciones,
      },
      ag.contenido.orden
    );
  }

  const promosPorSeccion = new Map<string, PromoCartaV1[]>();
  for (const pr of entrada.promos) {
    const lista = promosPorSeccion.get(pr.seccionCartaId) ?? [];
    lista.push({ id: pr.id, titulo: pr.titulo, descripcion: textoONull(pr.descripcion), precio: pr.precio, orden: pr.orden });
    promosPorSeccion.set(pr.seccionCartaId, lista);
  }

  const secciones: SeccionCartaV1[] = [...entrada.secciones]
    .sort((a, b) => a.orden - b.orden || comparar(a.nombre, b.nombre))
    .map((s) => {
      // Sueltos y agrupados comparten la misma escala de orden dentro de la sección: `orden` → nombre.
      const items = (itemsPorSeccion.get(s.id) ?? []).sort((a, b) => a.orden - b.orden || comparar(a.item.nombre, b.item.nombre)).map((x) => x.item);
      const promos = (promosPorSeccion.get(s.id) ?? []).sort((a, b) => a.orden - b.orden || comparar(a.titulo, b.titulo));
      return {
        id: s.id,
        nombre: s.nombre,
        titulo: textoONull(s.titulo),
        descripcion: textoONull(s.descripcion),
        imagenUrl: urlImagenSegura(s.imagenUrl),
        orden: s.orden,
        items,
        promos,
      };
    })
    .filter((s) => s.items.length > 0 || s.promos.length > 0);

  return {
    carta: {
      version: 1,
      generadoEn: entrada.generadoEn.toISOString(),
      sucursal: { id: entrada.sucursal.id, nombre: entrada.sucursal.nombre },
      secciones,
    },
    diagnostico: {
      visiblesSinSeccion: visiblesSinSeccion.sort((a, b) => comparar(a.nombre, b.nombre)),
      agrupadosSinSeccion: agrupadosSinSeccion.sort((a, b) => comparar(a.nombre, b.nombre)),
      agrupadosSinOpciones: agrupadosSinOpciones.sort((a, b) => comparar(a.nombre, b.nombre)),
      agrupadosConPreciosDistintos: agrupadosConPreciosDistintos.sort((a, b) => comparar(a.nombre, b.nombre)),
    },
  };
}
