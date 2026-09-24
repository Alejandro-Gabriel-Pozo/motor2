/**
 * Carta pública (docs/plan-carta-catalogo-2026-09-24.md, M2): arma la respuesta de `GET /api/carta/[sucursal]` a partir de
 * datos ya leídos. Lógica PURA, sin Prisma — mismo criterio que `disponibilidad-producto.ts` / `-consulta.ts`: la lectura
 * vive en `menu-consulta.ts`, un archivo aparte, para que un "use client" que importe un valor de acá (p. ej.
 * `urlImagenSegura` desde la pantalla de admin) nunca arrastre `@/lib/db` al bundle del cliente.
 *
 * Qué decide este módulo (y ningún otro):
 *  - el PRECIO que muestra la carta: el mismo que se cobra (`precioDeCarta`, paridad con `resolverPrecioVenta`);
 *  - cómo se agrupan los PV en secciones de carta (a través de la tabla puente categoría → sección);
 *  - cómo se arma un ÍTEM AGRUPADO ("Gaseosa 500cc" → Coca-Cola, Sprite, Fanta; docs/plan-agrupacion-items-carta-2026-09-24.md):
 *    su precio (el de sus opciones; si difieren, el MAYOR, D5) y que un producto agrupado nunca salga suelto (D3);
 *  - el ORDEN de secciones, ítems y promos;
 *  - qué `imagenUrl` es segura para la carta (`urlImagenSegura`).
 *
 * Qué NO decide: qué PV están disponibles en la sucursal ni cuáles son visibles en la carta — eso ya viene filtrado desde la
 * consulta (`whereDisponibleEn` + `ContenidoCartaProducto.visibleEnCarta`).
 */

// ---------------------------------------------------------------------------------------------------------------------
// Contrato público v1 (lo que viaja a restaurant-menu-design). Cambiar una forma = subir `version`.
// ---------------------------------------------------------------------------------------------------------------------

export interface ItemCartaV1 {
  productoId: string;
  nombre: string;
  /** Nombre de la CategoriaProducto del PV (p. ej. "Bife"). */
  categoria: string;
  descripcion: string | null;
  /** Precio final en pesos, numérico: el local habilitado de la sucursal o, si no, el precio de venta global. */
  precio: number;
  tags: string[];
  especial: boolean;
  imagenUrl: string | null;
  /**
   * SOLO en un ítem AGRUPADO (docs/plan-agrupacion-items-carta-2026-09-24.md, D6): los PV reales que agrupa, disponibles en la
   * sucursal y en su orden. En un ítem agrupado, `productoId` es el id del ítem agrupado (no de un Producto), `nombre`,
   * `descripcion`, `tags`, `especial` e `imagenUrl` son los del ítem agrupado, y `precio` es el de sus opciones (el mayor, si
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
  /** Filas de la tabla puente: qué categorías caen en esta sección y en qué orden. */
  categorias: ReadonlyArray<{ categoriaId: string; orden: number }>;
}

export interface ContenidoCartaEntrada {
  descripcion: string | null;
  imagenUrl: string | null;
  tags: readonly string[];
  especial: boolean;
  orden: number;
}

export interface ProductoCartaEntrada {
  id: string;
  nombre: string;
  precioVenta: number;
  categoriaId: string | null;
  categoriaNombre: string | null;
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
  categoriaId: string;
  categoriaNombre: string;
  /** Lo de cara al cliente del ítem agrupado (misma forma que el contenido de un PV). */
  contenido: ContenidoCartaEntrada;
  /** Ya filtradas: solo PV disponibles en la sucursal. */
  opciones: readonly OpcionAgrupadoEntrada[];
}

export interface ProductoSinSeccion {
  productoId: string;
  nombre: string;
  categoria: string | null;
}

export interface AgrupadoSinSeccion {
  id: string;
  nombre: string;
  categoria: string;
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
    /** PV disponibles y visibles que no aparecen porque su categoría no está en ninguna sección de carta activa. */
    visiblesSinSeccion: ProductoSinSeccion[];
    /** Ítems agrupados con opciones que no salen porque su categoría no está en ninguna sección de carta activa. */
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
 * El precio que muestra la carta = el que se cobra. MISMA regla que `resolverPrecioVenta` (src/core/movimientos/
 * precio-venta.ts, port de resolverPrecioVenta_ de Catalogo.js): el Precio Local si está cargado Y habilitado, si no el
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

  // categoría → (sección de carta, orden de la categoría dentro de la sección)
  const ubicacionPorCategoria = new Map<string, { seccionId: string; ordenCategoria: number }>();
  for (const s of entrada.secciones) {
    for (const c of s.categorias) ubicacionPorCategoria.set(c.categoriaId, { seccionId: s.id, ordenCategoria: c.orden });
  }

  type ItemConOrden = { item: ItemCartaV1; ordenCategoria: number; ordenContenido: number };
  const itemsPorSeccion = new Map<string, ItemConOrden[]>();
  const visiblesSinSeccion: ProductoSinSeccion[] = [];
  const agrupados = entrada.agrupados ?? [];

  // D3 (defensa): un producto que es opción de un ítem agrupado sale SOLO dentro del grupo, aunque venga también como suelto
  // (la consulta ya lo excluye; esto cubre cualquier entrada que no lo haga).
  const productosAgrupados = new Set(agrupados.flatMap((ag) => ag.opciones.map((o) => o.productoId)));

  for (const p of entrada.productos) {
    if (productosAgrupados.has(p.id)) continue;
    const ubicacion = p.categoriaId ? ubicacionPorCategoria.get(p.categoriaId) : undefined;
    if (!ubicacion || !p.categoriaNombre) {
      visiblesSinSeccion.push({ productoId: p.id, nombre: p.nombre, categoria: p.categoriaNombre });
      continue;
    }
    const item: ItemCartaV1 = {
      productoId: p.id,
      nombre: p.nombre,
      categoria: p.categoriaNombre,
      descripcion: textoONull(p.contenido.descripcion),
      precio: precioDeCarta(p.precioVenta, precioLocalPorProducto.get(p.id)),
      tags: limpiarTags(p.contenido.tags),
      especial: p.contenido.especial,
      imagenUrl: urlImagenSegura(p.contenido.imagenUrl),
    };
    const lista = itemsPorSeccion.get(ubicacion.seccionId) ?? [];
    lista.push({ item, ordenCategoria: ubicacion.ordenCategoria, ordenContenido: p.contenido.orden });
    itemsPorSeccion.set(ubicacion.seccionId, lista);
  }

  const agrupadosSinSeccion: AgrupadoSinSeccion[] = [];
  const agrupadosSinOpciones: { id: string; nombre: string }[] = [];
  const agrupadosConPreciosDistintos: AgrupadoConPreciosDistintos[] = [];

  for (const ag of agrupados) {
    if (ag.opciones.length === 0) {
      agrupadosSinOpciones.push({ id: ag.id, nombre: ag.nombre });
      continue;
    }
    const ubicacion = ubicacionPorCategoria.get(ag.categoriaId);
    if (!ubicacion) {
      agrupadosSinSeccion.push({ id: ag.id, nombre: ag.nombre, categoria: ag.categoriaNombre });
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
    const item: ItemCartaV1 = {
      productoId: ag.id,
      nombre: ag.nombre,
      categoria: ag.categoriaNombre,
      descripcion: textoONull(ag.contenido.descripcion),
      precio: maximo,
      tags: limpiarTags(ag.contenido.tags),
      especial: ag.contenido.especial,
      imagenUrl: urlImagenSegura(ag.contenido.imagenUrl),
      opciones,
    };
    const lista = itemsPorSeccion.get(ubicacion.seccionId) ?? [];
    lista.push({ item, ordenCategoria: ubicacion.ordenCategoria, ordenContenido: ag.contenido.orden });
    itemsPorSeccion.set(ubicacion.seccionId, lista);
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
      const items = (itemsPorSeccion.get(s.id) ?? [])
        .sort(
          (a, b) =>
            a.ordenCategoria - b.ordenCategoria ||
            // Dos categorías con el mismo orden en la sección: que sus ítems no se intercalen.
            comparar(a.item.categoria, b.item.categoria) ||
            a.ordenContenido - b.ordenContenido ||
            comparar(a.item.nombre, b.item.nombre)
        )
        .map((x) => x.item);
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
