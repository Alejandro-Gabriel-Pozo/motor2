import { redondearMoneda } from "@/core/moneda";
import {
  redondearCantidad,
  type Db,
  agruparVentasPorCategoria,
  obtenerReportePorPeriodoConCatalogo,
  pvSinCategoriaDe,
  type FilaCategoriaVenta,
  type generarReporteVentasPorCategoria,
} from "@/core/reportes/public-servidor";

/**
 * Ventas por SECCIÓN DE CARTA (docs/plan-carta-catalogo-2026-09-24.md, M4; rehecho a nivel de PRODUCTO en
 * docs/plan-carta-seccion-directa-2026-09-25.md, M5). Las mismas ventas que «Ventas por categoría» (mismo
 * `obtenerReportePorPeriodoConCatalogo`, mismo criterio de ventas reales/estimadas), agrupadas por la sección de carta donde el
 * cliente ve CADA producto — no por su categoría, que ya no ubica nada en la carta:
 *  - opción de un ítem agrupado → la sección del ítem agrupado (un producto agrupado sale solo ahí, D3);
 *  - si no, PV suelto con `ContenidoCartaProducto` visible y con sección → esa sección;
 *  - cualquier otro (sin contenido, oculto o sin sección) → "Sin sección".
 * Dos productos de la misma categoría pueden caer en secciones distintas: dentro de cada sección las ventas se vuelven a
 * agrupar por categoría (`agruparVentasPorCategoria`, la misma función del reporte por categoría), así que una categoría puede
 * aparecer en más de una sección con la parte de sus ventas que cae en cada una. Los totales siguen cerrando con los del reporte
 * por categoría. Una sola consulta extra: dónde se ve cada producto en la carta.
 */

export type ReporteVentasPorCategoria = Awaited<ReturnType<typeof generarReporteVentasPorCategoria>>;

export const SIN_SECCION = "Sin sección";

/** La sección de carta donde se ve un producto. */
export interface SeccionDeProducto {
  nombre: string;
  orden: number;
}

/** Una venta del período por producto, con lo que hace falta para ubicarla. */
export interface VentaParaSeccion {
  productoId: string;
  producto: string;
  categoria: string | null;
  cantidad: number;
  importe: number;
}

export interface VentasParaSeccion {
  desde: ReporteVentasPorCategoria["desde"];
  hasta: ReporteVentasPorCategoria["hasta"];
  totalFacturado: ReporteVentasPorCategoria["totalFacturado"];
  aviso: ReporteVentasPorCategoria["aviso"];
  porProducto: readonly VentaParaSeccion[];
  pvSinCategoria: string[];
}

export interface FilaSeccionVenta {
  seccion: string;
  cantidad: number;
  importe: number;
  /** Las ventas de ESTA sección agrupadas por categoría, como en el reporte por categoría (importe descendente). */
  categorias: FilaCategoriaVenta[];
}

export interface ReporteVentasPorSeccion {
  desde: ReporteVentasPorCategoria["desde"];
  hasta: ReporteVentasPorCategoria["hasta"];
  totalFacturado: ReporteVentasPorCategoria["totalFacturado"];
  aviso: ReporteVentasPorCategoria["aviso"];
  /** Por el orden de la carta (orden de la sección, después nombre); "Sin sección" siempre al final. */
  porSeccion: FilaSeccionVenta[];
  pvSinCategoria: string[];
  /** Productos CON ventas en el rango que no se ven en ninguna sección de carta (van a "Sin sección"). */
  productosSinSeccion: string[];
}

/** Pura: agrupa las ventas por producto en secciones de carta. `seccionPorProducto`: id de producto → la sección donde se ve. */
export function reagruparPorSeccion(rep: VentasParaSeccion, seccionPorProducto: ReadonlyMap<string, SeccionDeProducto>): ReporteVentasPorSeccion {
  const grupos = new Map<string, { orden: number; ventas: VentaParaSeccion[] }>();
  const productosSinSeccion: string[] = [];

  for (const v of rep.porProducto) {
    const seccion = seccionPorProducto.get(v.productoId);
    if (!seccion) productosSinSeccion.push(v.producto);
    const clave = seccion?.nombre ?? SIN_SECCION;
    const grupo = grupos.get(clave) ?? { orden: seccion?.orden ?? Number.POSITIVE_INFINITY, ventas: [] };
    grupo.ventas.push(v);
    grupos.set(clave, grupo);
  }

  const porSeccion = Array.from(grupos.entries())
    .sort(([na, a], [nb, b]) => {
      if (na === SIN_SECCION) return 1;
      if (nb === SIN_SECCION) return -1;
      return a.orden - b.orden || na.localeCompare(nb, "es");
    })
    .map(([seccion, g]) => ({
      seccion,
      cantidad: redondearCantidad(g.ventas.reduce((s, v) => s + v.cantidad, 0)),
      importe: redondearMoneda(g.ventas.reduce((s, v) => s + v.importe, 0)),
      categorias: agruparVentasPorCategoria(g.ventas),
    }));

  return {
    desde: rep.desde,
    hasta: rep.hasta,
    totalFacturado: rep.totalFacturado,
    aviso: rep.aviso,
    porSeccion,
    pvSinCategoria: rep.pvSinCategoria,
    productosSinSeccion: [...new Set(productosSinSeccion)].sort((a, b) => a.localeCompare(b, "es")),
  };
}

/** Dónde se ve cada producto en la carta (solo los que se ven en alguna sección): UNA consulta. */
async function seccionesDeProductos(db: Db): Promise<Map<string, SeccionDeProducto>> {
  const seccion = { select: { nombre: true, orden: true } } as const;
  const filas = await db.producto.findMany({
    where: { OR: [{ opcionItemAgrupadoCarta: { isNot: null } }, { contenidoCarta: { is: { visibleEnCarta: true, seccionCartaId: { not: null } } } }] },
    select: {
      id: true,
      contenidoCarta: { select: { visibleEnCarta: true, seccionCarta: seccion } },
      opcionItemAgrupadoCarta: { select: { itemAgrupadoCarta: { select: { seccionCarta: seccion } } } },
    },
  });
  const mapa = new Map<string, SeccionDeProducto>();
  for (const f of filas) {
    // D3: un producto agrupado sale solo dentro de su ítem agrupado, aunque tenga contenido propio visible.
    const s = f.opcionItemAgrupadoCarta?.itemAgrupadoCarta.seccionCarta ?? (f.contenidoCarta?.visibleEnCarta ? f.contenidoCarta.seccionCarta : null);
    if (s) mapa.set(f.id, { nombre: s.nombre, orden: s.orden });
  }
  return mapa;
}

/** Las ventas del período (el mismo reporte base que «Ventas por categoría») + UNA consulta de ubicación, agrupadas por sección de carta. */
export async function generarReporteVentasPorSeccion(sucursalId: string, desde: Date, hasta: Date, db: Db): Promise<ReporteVentasPorSeccion> {
  const [{ reporte: rep, productos }, seccionPorProducto] = await Promise.all([
    obtenerReportePorPeriodoConCatalogo(sucursalId, desde, hasta, { proceso: "VENTA" }, db),
    seccionesDeProductos(db),
  ]);
  return reagruparPorSeccion(
    {
      desde: rep.desde,
      hasta: rep.hasta,
      totalFacturado: rep.ventas.totalFacturado,
      aviso: rep.ventas.aviso,
      porProducto: rep.ventas.porProducto.map((v) => ({
        productoId: v.productoId,
        producto: v.producto,
        categoria: productos.get(v.productoId)?.categoriaNombre ?? null,
        cantidad: v.cantidad,
        importe: v.importe,
      })),
      pvSinCategoria: pvSinCategoriaDe(productos),
    },
    seccionPorProducto
  );
}
