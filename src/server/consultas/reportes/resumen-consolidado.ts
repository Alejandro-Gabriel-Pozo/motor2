import "server-only";
import { armarAlertasStock, resumirAlertasStock } from "@/core/stock/public";
import { calcularComprasDelPeriodo, calcularMargenNominalDelPeriodo, calcularVentasDelPeriodo, resolverRangoPorDefecto } from "@/core/reportes/public";
import type { ClasificacionNoComestibles } from "@/core/catalogo/public";
import { cargarCatalogoDeProductos, cargarClasificacionNoComestibles, type CatalogoDeProductos } from "@/server/lecturas/reportes/comun";
import { calcularCostosYMargenes } from "@/server/lecturas/reportes/costos";
import { cargarLineasDelPeriodo } from "@/server/consultas/reportes/periodo";
import type { Db } from "@/lib/db-tipos";
import type { FilaResumenConsolidado } from "@/core/reportes/public";

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
 *  - por sucursal queda solo lo que es de ella: las líneas del período, su Precio Local y su disponibilidad (el mapa de productos), sus recetas (la propia
 *    o la central con sus calibraciones) y su costo de reposición — y se calcula solo lo que se muestra: ventas (`calcularVentasDelPeriodo`), gastado
 *    (`calcularComprasDelPeriodo`) y el margen NOMINAL (`calcularMargenNominalDelPeriodo`, el mismo `margenTotal` del reporte del período).
 * Lo que sigue creciendo con las sucursales (7 lecturas cada una) son esos cargadores por sucursal, que hoy no tienen versión en bloque.
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
  const [alertasPorSucursal, financieros] = await Promise.all([
    resumirAlertasDeSucursales(sucursales.map((s) => s.id), catalogo, db),
    Promise.all(sucursales.map((s) => financieroDeLaSucursal(s.id, desde, hasta, db, { clasificacion, catalogo }))),
  ]);
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
 * período (`obtenerReportePorPeriodoConCatalogo`), con las mismas líneas y el mismo catálogo, sin calcular lo demás.
 */
async function financieroDeLaSucursal(
  sucursalId: string,
  desde: Date,
  hasta: Date,
  db: Db,
  cargado: { clasificacion: ClasificacionNoComestibles; catalogo: CatalogoDeProductos }
): Promise<{ ventasTotal: number; margenTotal: number; gastadoTotal: number }> {
  const { items, productos } = await cargarLineasDelPeriodo(sucursalId, desde, hasta, {}, db, cargado);
  const ventas = calcularVentasDelPeriodo(items, productos);
  const compras = calcularComprasDelPeriodo(items, productos);
  // El costo de HOY de cada plato (receta efectiva de la sucursal + su costo de reposición), sin objetivos: lo mismo que usa el margen del período.
  const { margenTotal } = calcularMargenNominalDelPeriodo(ventas, await calcularCostosYMargenes(sucursalId, db, productos));
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
