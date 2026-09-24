import { prisma } from "@/lib/db";
import { redondearMoneda } from "@/core/movimientos/transiciones";
import { redondearCantidad, type Db } from "@/core/reportes/comun";
import { generarReporteVentasPorCategoria, type FilaCategoriaVenta } from "@/core/reportes/periodo";

/**
 * Ventas por SECCIÓN DE CARTA (docs/plan-carta-catalogo-2026-09-24.md, M4): un rollup de "Ventas por categoría" — no un
 * reporte nuevo. Compone `generarReporteVentasPorCategoria` SIN tocarlo (mismo criterio de ventas reales/estimadas, mismas
 * filas de categoría) y solo reagrupa sus categorías por la tabla puente CategoriaSeccionCarta, con UNA consulta extra.
 *
 * Ojo: el reporte por categoría agrupa por NOMBRE de categoría (no por id) y junta los PV sin categoría en "Sin categoría".
 * Por eso el mapa es por `CategoriaProducto.nombre` (que es `@unique`, así que no hay ambigüedad). "Sin categoría" y las
 * categorías que no están en ninguna sección de carta caen en el grupo "Sin sección".
 */

export type ReporteVentasPorCategoria = Awaited<ReturnType<typeof generarReporteVentasPorCategoria>>;

export const SIN_SECCION = "Sin sección";

export interface SeccionDeCategoria {
  nombre: string;
  orden: number;
}

export interface FilaSeccionVenta {
  seccion: string;
  cantidad: number;
  importe: number;
  /** Las filas del reporte por categoría, tal cual (mismo objeto, mismo orden relativo: importe descendente). */
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
  /** Categorías CON ventas en el rango que no están en ninguna sección de carta (van a "Sin sección"). */
  categoriasSinSeccion: string[];
}

/** Pura: reagrupa las filas de categoría en secciones de carta. `seccionPorNombreCategoria`: nombre de categoría → su sección. */
export function reagruparPorSeccion(rep: ReporteVentasPorCategoria, seccionPorNombreCategoria: ReadonlyMap<string, SeccionDeCategoria>): ReporteVentasPorSeccion {
  const grupos = new Map<string, { orden: number; categorias: FilaCategoriaVenta[] }>();
  const categoriasSinSeccion: string[] = [];

  for (const fila of rep.porCategoria) {
    const seccion = seccionPorNombreCategoria.get(fila.categoria);
    if (!seccion && fila.categoria !== "Sin categoría") categoriasSinSeccion.push(fila.categoria);
    const clave = seccion?.nombre ?? SIN_SECCION;
    const grupo = grupos.get(clave) ?? { orden: seccion?.orden ?? Number.POSITIVE_INFINITY, categorias: [] };
    grupo.categorias.push(fila);
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
      cantidad: redondearCantidad(g.categorias.reduce((s, c) => s + c.cantidad, 0)),
      importe: redondearMoneda(g.categorias.reduce((s, c) => s + c.importe, 0)),
      categorias: g.categorias,
    }));

  return {
    desde: rep.desde,
    hasta: rep.hasta,
    totalFacturado: rep.totalFacturado,
    aviso: rep.aviso,
    porSeccion,
    pvSinCategoria: rep.pvSinCategoria,
    categoriasSinSeccion: categoriasSinSeccion.sort((a, b) => a.localeCompare(b, "es")),
  };
}

/** El reporte por categoría de siempre + UNA consulta a la tabla puente, reagrupado por sección de carta. */
export async function generarReporteVentasPorSeccion(sucursalId: string, desde: Date, hasta: Date, db: Db = prisma): Promise<ReporteVentasPorSeccion> {
  const [rep, puente] = await Promise.all([
    generarReporteVentasPorCategoria(sucursalId, desde, hasta, db),
    db.categoriaSeccionCarta.findMany({ select: { categoria: { select: { nombre: true } }, seccionCarta: { select: { nombre: true, orden: true } } } }),
  ]);
  const seccionPorNombreCategoria = new Map(puente.map((f) => [f.categoria.nombre, { nombre: f.seccionCarta.nombre, orden: f.seccionCarta.orden }]));
  return reagruparPorSeccion(rep, seccionPorNombreCategoria);
}
