import "server-only";
import { armarAlertasStock, resumirAlertasStock } from "@/core/stock/public";
import { calcularComprasDelPeriodo, calcularMargenNominalDelPeriodo, calcularVentasDelPeriodo, resolverRangoPorDefecto } from "@/core/reportes/public";
import { cargarCatalogoDeProductos, cargarClasificacionNoComestibles, obtenerCostoActualPorMPDeSucursales, type CatalogoDeProductos } from "@/server/lecturas/reportes/comun";
import { calcularCostosYMargenes } from "@/server/lecturas/reportes/costos";
import { cargarLineasDelPeriodoDeSucursales } from "@/server/consultas/reportes/periodo";
import { disponibilidadDeProductosEnSucursales } from "@/server/lecturas/catalogo/disponibilidad";
import type { Db } from "@/lib/db-tipos";
import type { CostoMP, FilaResumenConsolidado, InfoProductoReporte, ItemPeriodo } from "@/core/reportes/public";

/**
 * Un resumen por sucursal, lado a lado — para quien pertenece a varias (ver src/core/auth/contexto.ts, `membresias`). Muestra SOLO ventas, margen, gastado y
 * la cantidad de alertas de stock de cada sucursal, con los MISMOS números que el resumen operativo de cada una (`obtenerResumenOperativo` con el rango por
 * defecto): mismas líneas del período, mismo catálogo, mismas funciones de cálculo.
 *
 * O.38 de docs/pureza-integracion.md: antes armaba un resumen operativo COMPLETO por sucursal (el reporte del período entero —margen Real, IPC, tendencia y
 * comparativa de precios, impacto de recetas, alerta de margen objetivo— más el stock por proceso), ~26 consultas por sucursal, para mostrar 5 números.
 * Ahora:
 *  - lo COMÚN a todas las sucursales se lee una vez: la clasificación de «No comestibles» y el catálogo crudo (con él se arma el mapa de cada sucursal y se
 *    nombran los productos de las alertas);
 *  - las alertas de stock de TODAS las sucursales salen de tres lecturas en bloque (saldos, secciones, mínimos), repartidas por la sucursal de cada sección;
 *  - por sucursal queda solo lo que es de ella: su Precio Local y su disponibilidad (el mapa de productos), sus recetas (la propia o la central con sus
 *    calibraciones) y su costo de reposición — y se calcula solo lo que se muestra: ventas (`calcularVentasDelPeriodo`), gastado
 *    (`calcularComprasDelPeriodo`) y el margen NOMINAL (`calcularMargenNominalDelPeriodo`, el mismo `margenTotal` del reporte del período).
 * O.38b (D1, D2 y D3 de docs/plan-hito-4-pureza.md §4): las líneas del período (`cargarLineasDelPeriodoDeSucursales`), el costo de reposición
 * (`obtenerCostoActualPorMPDeSucursales`) y la disponibilidad (`disponibilidadDeProductosEnSucursales`) de todas las sucursales salen de UNA lectura cada
 * uno, con la misma implementación que usa el reporte (y la venta) de una sucursal con un solo elemento: 8 + 4N lecturas. Lo que sigue creciendo con las
 * sucursales (4 lecturas cada una) es el Precio Local con su capacidad y las recetas vigentes (propia y central), DIFERIDOS por decisión del dueño hasta
 * después de 4A-5 y del segundo tiempo de la venta: `sucursalTieneCapacidad` la usa también el gate, `preciosLocalesVigentes` es la frontera de la carta
 * pública, y las recetas propias se leen por par (sucursal, producto), donde un filtro mal armado elegiría una serie deshabilitada.
 */
export async function obtenerResumenConsolidado(
  sucursales: { id: string; nombre: string }[],
  db: Db,
  ahora: Date
): Promise<FilaResumenConsolidado[]> {
  if (sucursales.length === 0) return [];
  // El mismo rango que `obtenerResumenOperativo` sin rango explícito (el default del selector, ver rango-por-defecto.ts).
  const rango = resolverRangoPorDefecto(undefined, ahora);
  const desde = new Date(rango.desdeISO);
  const hasta = new Date(rango.hastaISO);

  const [clasificacion, catalogo] = await Promise.all([cargarClasificacionNoComestibles(db), cargarCatalogoDeProductos(db)]);
  const sucursalIds = sucursales.map((s) => s.id);
  const [alertasPorSucursal, lineas, costos] = await Promise.all([
    resumirAlertasDeSucursales(sucursalIds, catalogo, db),
    // La disponibilidad de los productos del catálogo en TODAS las sucursales en una lectura (O.38b, D3), y con ella las líneas del período de todas en
    // otra (D1) y el catálogo de cada una (que así solo lee su Precio Local).
    disponibilidadDeProductosEnSucursales(
      sucursalIds,
      catalogo.map((p) => p.id),
      db
    ).then((disponibilidad) => cargarLineasDelPeriodoDeSucursales(sucursalIds, desde, hasta, {}, db, { clasificacion, catalogo, disponibilidad })),
    // El costo de reposición de HOY de todas las sucursales en una lectura (O.38b, D2).
    obtenerCostoActualPorMPDeSucursales(sucursalIds, db),
  ]);
  const financieros = await Promise.all(sucursales.map((s) => financieroDeLaSucursal(s.id, lineas.porSucursal.get(s.id)!, costos.get(s.id)!, db)));
  return sucursales.map((s, i) => {
    const alertas = alertasPorSucursal.get(s.id) ?? { criticos: 0, bajos: 0 };
    return {
      sucursalId: s.id,
      sucursalNombre: s.nombre,
      ventasTotal: financieros[i].ventasTotal,
      margenTotal: financieros[i].margenTotal,
      gastadoTotal: financieros[i].gastadoTotal,
      alertasCriticas: alertas.criticos,
      alertasBajas: alertas.bajos,
    };
  });
}

/**
 * Ventas, margen y gastado de UNA sucursal en el rango: lo mismo que `ventas.totalFacturado`, `margen.margenTotal` y `compras.totalGastado` del reporte del
 * período (`obtenerReportePorPeriodoConCatalogo`), con las mismas líneas y el mismo catálogo (los de esta sucursal en `cargarLineasDelPeriodoDeSucursales`),
 * sin calcular lo demás.
 */
async function financieroDeLaSucursal(
  sucursalId: string,
  { items, productos }: { items: ItemPeriodo[]; productos: Map<string, InfoProductoReporte> },
  costosActuales: Map<string, CostoMP>,
  db: Db
): Promise<{ ventasTotal: number; margenTotal: number; gastadoTotal: number }> {
  const ventas = calcularVentasDelPeriodo(items, productos);
  const compras = calcularComprasDelPeriodo(items, productos);
  // El costo de HOY de cada plato (receta efectiva de la sucursal + su costo de reposición, ya leído), sin objetivos: lo mismo que usa el margen del período.
  const { margenTotal } = calcularMargenNominalDelPeriodo(ventas, await calcularCostosYMargenes(sucursalId, db, productos, undefined, undefined, costosActuales));
  return { ventasTotal: ventas.totalFacturado, margenTotal, gastadoTotal: compras.totalGastado };
}

/**
 * Críticas y bajas de cada sucursal, con las mismas reglas que el resumen operativo (`armarAlertasStock` sobre el LIBRO MAYOR: los saldos de lo que ya tuvo
 * movimiento), en TRES lecturas para todas las sucursales: los saldos agrupados por (producto, sección) —cada sección es de una sola sucursal, así que los
 * grupos son los mismos que por sucursal—, las secciones (de ahí sale de qué sucursal es cada saldo) y los mínimos. Los productos salen del catálogo ya
 * leído (`armarAlertasStock` los busca por id: que estén todos no cambia nada).
 */
async function resumirAlertasDeSucursales(sucursalIds: string[], catalogo: CatalogoDeProductos, db: Db): Promise<Map<string, { criticos: number; bajos: number }>> {
  const saldos = await db.movimientoStock.groupBy({
    by: ["productoId", "seccionId"],
    where: { seccion: { sucursalId: { in: sucursalIds } } },
    _sum: { cantidad: true },
    _max: { creadoEn: true },
  });
  const productoIds = Array.from(new Set(saldos.map((s) => s.productoId)));
  const seccionIds = Array.from(new Set(saldos.map((s) => s.seccionId)));
  const [secciones, minimos] = await Promise.all([
    db.seccion.findMany({ where: { id: { in: seccionIds } }, select: { id: true, nombre: true, sucursalId: true } }),
    db.stockMinimoProducto.findMany({ where: { sucursalId: { in: sucursalIds }, productoId: { in: productoIds } }, select: { sucursalId: true, productoId: true, seccionId: true, minimo: true } }),
  ]);
  const sucursalDeSeccion = new Map(secciones.map((s) => [s.id, s.sucursalId]));

  const resultado = new Map<string, { criticos: number; bajos: number }>();
  for (const sucursalId of sucursalIds) {
    const alertas = resumirAlertasStock(
      armarAlertasStock({
        saldos: saldos
          .filter((s) => sucursalDeSeccion.get(s.seccionId) === sucursalId)
          .map((s) => ({ productoId: s.productoId, seccionId: s.seccionId, saldo: Number(s._sum.cantidad ?? 0), ultimaFecha: s._max.creadoEn })),
        productos: catalogo,
        secciones: secciones.filter((s) => s.sucursalId === sucursalId),
        minimos: minimos.filter((m) => m.sucursalId === sucursalId).map((m) => ({ productoId: m.productoId, seccionId: m.seccionId, minimo: Number(m.minimo) })),
      })
    );
    resultado.set(sucursalId, { criticos: alertas.criticos, bajos: alertas.bajos });
  }
  return resultado;
}
