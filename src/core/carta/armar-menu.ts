/**
 * Carta pública (docs/plan-carta-catalogo-2026-09-24.md, M2): arma la respuesta de `GET /api/carta/[sucursal]` a partir de
 * datos ya leídos. Lógica PURA, sin Prisma — mismo criterio que `disponibilidad-producto.ts` / `-consulta.ts`: la lectura
 * vive en `menu-consulta.ts`, un archivo aparte, para que un "use client" que importe un valor de acá (p. ej.
 * `urlImagenSegura` desde la pantalla de admin) nunca arrastre `@/lib/db` al bundle del cliente.
 *
 * Qué decide este módulo (y ningún otro):
 *  - el PRECIO que muestra la carta: el mismo que se cobra (`precioDeCarta`, paridad con `resolverPrecioVenta`);
 *  - cómo se agrupan los PV en secciones de carta (a través de la tabla puente categoría → sección);
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
}

export interface ProductoSinSeccion {
  productoId: string;
  nombre: string;
  categoria: string | null;
}

export interface MenuArmado {
  carta: CartaV1;
  /** Solo para uso interno (admin/logs): el endpoint NO lo expone. */
  diagnostico: {
    /** PV disponibles y visibles que no aparecen porque su categoría no está en ninguna sección de carta activa. */
    visiblesSinSeccion: ProductoSinSeccion[];
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

  for (const p of entrada.productos) {
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
    diagnostico: { visiblesSinSeccion: visiblesSinSeccion.sort((a, b) => comparar(a.nombre, b.nombre)) },
  };
}
