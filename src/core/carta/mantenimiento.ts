/**
 * CARTA-MANT (mantenimiento de la carta, prototipo aprobado «Mantenimiento / Parametrización»): cómo se ordena la pantalla de la carta de UNA sucursal. Puro: recibe lo que leyó la
 * consulta (`server/consultas/carta/mantenimiento.ts`) y decide en qué lista va cada producto de venta.
 *
 * La premisa (decisión del dueño, 2026-10-14): lo que sale en la carta pública lo ve el cliente; el MENÚ DEL DÍA y lo que se vende solo en el POS NUNCA sale en la carta (hasta que se cocina no se
 * sabe qué hay). Por eso un producto de venta disponible acá SIN contenido de carta no es un faltante: es «Fuera de carta (POS y menú del día)», un contador informativo, y no se avisa. El producto
 * de RESPALDO de un adicional (el «ancla», `OpcionDeGrupo.productoId`) se vende solo como adicional: no figura en ninguna lista de la carta.
 *
 * Cada producto cae en UNA sola lista, en este orden de prioridad:
 *  1. ancla de un adicional → en ninguna;
 *  2. dentro de un ítem agrupado de esta sucursal → `enAgrupados` (sale en la carta dentro del agrupado, su contenido propio no se usa);
 *  3. con contenido de carta con sección → esa sección (aunque hoy no esté disponible: «sin stock hoy» es otra cosa que «fuera de carta»);
 *  4. con contenido sin sección (solo un contenido oculto puede no tener sección) → `sinSeccion`;
 *  5. sin contenido y disponible acá → `fueraDeCarta`;
 *  6. sin contenido y no disponible acá → en ninguna (no se ofrece en esta sucursal).
 */

export interface SeccionParaMantener {
  id: string;
  nombre: string;
  orden: number;
  /** La sección es de la EMPRESA (`SeccionCarta.activa`): apagada, no sale en la carta de ninguna sucursal. */
  activa: boolean;
}

export interface ProductoParaMantener {
  id: string;
  nombre: string;
  /** El precio que rige en esta sucursal (el local vigente o el de lista), en pesos. */
  precioAca: number;
  disponibleAca: boolean;
  esAnclaDeAdicional: boolean;
  /** El nombre del ítem agrupado de esta sucursal que lo contiene, si hay. */
  agrupadoEn: string | null;
  contenido: { visibleEnCarta: boolean; seccionCartaId: string | null; orden: number } | null;
}

export interface SeccionConProductos extends SeccionParaMantener {
  /** Por `orden` del contenido y después por nombre. */
  productos: ProductoParaMantener[];
}

export interface CartaParaMantener {
  /** Todas las secciones de la empresa, en su orden, cada una con sus productos de esta sucursal (puede quedar vacía). */
  secciones: SeccionConProductos[];
  sinSeccion: ProductoParaMantener[];
  enAgrupados: ProductoParaMantener[];
  /** Disponibles acá y sin contenido de carta: el POS y el menú del día. Por nombre. */
  fueraDeCarta: ProductoParaMantener[];
}

const porNombre = (a: { nombre: string }, b: { nombre: string }) => a.nombre.localeCompare(b.nombre, "es");

export function organizarCartaParaMantener(secciones: readonly SeccionParaMantener[], productos: readonly ProductoParaMantener[]): CartaParaMantener {
  const porSeccion = new Map<string, ProductoParaMantener[]>(secciones.map((s) => [s.id, []]));
  const sinSeccion: ProductoParaMantener[] = [];
  const enAgrupados: ProductoParaMantener[] = [];
  const fueraDeCarta: ProductoParaMantener[] = [];
  for (const p of productos) {
    if (p.esAnclaDeAdicional) continue;
    if (p.agrupadoEn !== null) enAgrupados.push(p);
    else if (p.contenido) {
      const lista = p.contenido.seccionCartaId === null ? undefined : porSeccion.get(p.contenido.seccionCartaId);
      (lista ?? sinSeccion).push(p);
    } else if (p.disponibleAca) fueraDeCarta.push(p);
  }
  const porOrden = (a: ProductoParaMantener, b: ProductoParaMantener) => (a.contenido?.orden ?? 0) - (b.contenido?.orden ?? 0) || porNombre(a, b);
  return {
    secciones: secciones.map((s) => ({ ...s, productos: (porSeccion.get(s.id) ?? []).sort(porOrden) })),
    sinSeccion: sinSeccion.sort(porNombre),
    enAgrupados: enAgrupados.sort(porNombre),
    fueraDeCarta: fueraDeCarta.sort(porNombre),
  };
}

/** Sin mayúsculas ni acentos, para buscar por nombre («milanesa» encuentra «Milanesa NAPOLITANA», «jamon» encuentra «Jamón»). */
function normalizarParaBuscar(texto: string): string {
  return texto.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}

/** ¿El nombre tiene TODAS las palabras buscadas (en cualquier orden)? Una búsqueda vacía coincide con todo. */
export function coincideConLaBusqueda(nombre: string, busqueda: string): boolean {
  const palabras = normalizarParaBuscar(busqueda).split(/\s+/).filter(Boolean);
  const enNombre = normalizarParaBuscar(nombre);
  return palabras.every((p) => enNombre.includes(p));
}

/** El tope del orden de carta (el mismo de `validarOrdenCarta`). */
const ORDEN_MAXIMO = 100_000;

/**
 * El orden que toma un producto que se AGREGA a una sección: al final, uno más que el mayor de lo que ya tiene la sección en esta sucursal (productos e ítems agrupados, que comparten la escala);
 * 0 si está vacía. Nunca pasa el tope de `validarOrdenCarta` (ahí queda empatado con el último y desempata el nombre).
 */
export function ordenAlFinalDeLaSeccion(ordenesDeLaSeccion: readonly number[]): number {
  if (ordenesDeLaSeccion.length === 0) return 0;
  return Math.min(ORDEN_MAXIMO, Math.max(0, ...ordenesDeLaSeccion) + 1);
}
