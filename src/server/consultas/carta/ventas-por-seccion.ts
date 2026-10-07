import "server-only";
import { whereCartaDeSucursal } from "@/core/carta/public";
import { redondearMoneda } from "@/core/moneda";
import type { Db } from "@/lib/db-tipos";
import { agruparVentasPorCategoria, pvSinCategoriaDe, type FilaCategoriaVenta } from "@/core/reportes/public-servidor";
import { cargarLineasDelPeriodo, type generarReporteVentasPorCategoria } from "@/server/consultas/reportes/periodo";
import { calcularVentasDelPeriodo, redondearCantidad } from "@/core/reportes/public";

/**
 * Ventas por SECCIÓN DE CARTA (docs/plan-carta-catalogo-2026-09-24.md, M4; rehecho a nivel de PRODUCTO en
 * docs/plan-carta-seccion-directa-2026-09-25.md, M5). Las mismas ventas que «Ventas por categoría» (mismo
 * `cargarLineasDelPeriodo` + `calcularVentasDelPeriodo`, mismo criterio de ventas reales/estimadas), agrupadas por la sección de carta donde el
 * cliente ve CADA producto EN LA CARTA PROPIA DE LA SUCURSAL (ADR-009, C3) — no por su categoría, que ya no ubica nada en la carta:
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

/** Dónde se ve cada producto en la carta PROPIA de la sucursal (solo los que se ven en alguna sección): UNA consulta. */
async function seccionesDeProductos(sucursalId: string, db: Db): Promise<Map<string, SeccionDeProducto>> {
  const seccion = { select: { nombre: true, orden: true } } as const;
  const filas = await db.producto.findMany({
    where: { OR: [{ opcionesItemAgrupadoCarta: { some: whereCartaDeSucursal(sucursalId) } }, { contenidosCarta: { some: { ...whereCartaDeSucursal(sucursalId), visibleEnCarta: true, seccionCartaId: { not: null } } } }] },
    select: {
      id: true,
      contenidosCarta: { where: whereCartaDeSucursal(sucursalId), take: 1, select: { visibleEnCarta: true, seccionCarta: seccion } },
      opcionesItemAgrupadoCarta: { where: whereCartaDeSucursal(sucursalId), take: 1, select: { itemAgrupadoCarta: { select: { seccionCarta: seccion } } } },
    },
  });
  const mapa = new Map<string, SeccionDeProducto>();
  for (const f of filas) {
    // D3: un producto agrupado sale solo dentro de su ítem agrupado, aunque tenga contenido propio visible.
    const contenido = f.contenidosCarta[0];
    const s = f.opcionesItemAgrupadoCarta[0]?.itemAgrupadoCarta.seccionCarta ?? (contenido?.visibleEnCarta ? contenido.seccionCarta : null);
    if (s) mapa.set(f.id, { nombre: s.nombre, orden: s.orden });
  }
  return mapa;
}

/**
 * Las ventas del período (la misma base que «Ventas por categoría»: `cargarLineasDelPeriodo` + `calcularVentasDelPeriodo`) + UNA consulta de ubicación,
 * agrupadas por sección de carta. Solo las ventas: antes armaba el reporte del período ENTERO (margen Real, IPC, impacto de recetas…, 23 consultas) para
 * quedarse con `ventas` y el catálogo (O.39 de docs/pureza-integracion.md).
 */
export async function generarReporteVentasPorSeccion(sucursalId: string, desde: Date, hasta: Date, db: Db): Promise<ReporteVentasPorSeccion> {
  const [{ desde: desdeRango, hasta: hastaRango, items, productos }, seccionPorProducto] = await Promise.all([
    cargarLineasDelPeriodo(sucursalId, desde, hasta, { proceso: "VENTA" }, db),
    seccionesDeProductos(sucursalId, db),
  ]);
  const ventas = calcularVentasDelPeriodo(items, productos);
  return reagruparPorSeccion(
    {
      desde: desdeRango,
      hasta: hastaRango,
      totalFacturado: ventas.totalFacturado,
      aviso: ventas.aviso,
      porProducto: ventas.porProducto.map((v) => ({
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
