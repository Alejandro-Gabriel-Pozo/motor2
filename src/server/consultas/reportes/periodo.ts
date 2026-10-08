import { esSignoFijo } from "@/core/movimientos/public";
import type { ClasificacionNoComestibles } from "@/core/catalogo/public";
import { preciosLocalesVigentes } from "@/core/catalogo/public-servidor";
import { cargarClasificacionNoComestibles, construirIndiceRecetas, construirMapaProductos, obtenerCostoActualPorMP, type CatalogoDeProductos } from "@/server/lecturas/reportes/comun";
import { cargarSerieIPC } from "@/server/lecturas/reportes/serie-ipc";
import { calcularCostosYMargenes, calcularImpactoRecetasPorPeriodo } from "@/server/lecturas/reportes/costos";
import type { Db } from "@/lib/db-tipos";
import { hayObjetivosCargados, resumirFueraDeObjetivo, rangoUtc, generarDigestAlertas, calcularComprasDelPeriodo, calcularGastoPorInsumoDelPeriodo, calcularVentasDelPeriodo, agruparVentasPorCategoria, pvSinCategoriaDe, type FiltrosPeriodo, type ItemPeriodo } from "@/core/reportes/public";
import { cargarObjetivosDeMargen } from "@/server/consultas/reportes/margen-objetivo-consulta";
import { calcularRatioGastoVentas } from "@/server/consultas/reportes/periodo-ratio";
import { calcularComparativaPreciosDelPeriodo, calcularTendenciaPreciosDelPeriodo } from "@/server/consultas/reportes/periodo-precios";
import { calcularMargenDelPeriodo } from "@/server/consultas/reportes/periodo-margen";

/**
 * Port de obtenerReportePorPeriodo (Reportes.js:30-109) — a diferencia del
 * original (rescanear la hoja Historial entera y filtrar en memoria), acá
 * el filtro de fecha/sección/producto/proceso ya va en el WHERE de
 * Postgres; el resultado sigue siendo "1 fila = 1 línea de Kardex" porque
 * varios reportes (CSV, margen, compras) necesitan ese detalle línea por
 * línea, no un agregado.
 *
 * `ahora` (D.3b de docs/pureza-integracion.md) es obligatorio: lo usan el margen y la comparativa de precios (la antigüedad de la serie del IPC).
 */
export async function obtenerReportePorPeriodo(sucursalId: string, desdeIn: Date, hastaIn: Date, filtros: FiltrosPeriodo = {}, db: Db, ahora: Date) {
  return (await obtenerReportePorPeriodoConCatalogo(sucursalId, desdeIn, hastaIn, filtros, db, ahora)).reporte;
}

/**
 * La base de TODO reporte del período: las líneas de Kardex del rango (1 fila = 1 línea, con el filtro de fecha/sección/producto/proceso ya en el WHERE) y
 * el catálogo de la sucursal con el que se leen (`productos`, con el `precioVenta` resuelto con su Precio Local). La usan el reporte completo
 * (`obtenerReportePorPeriodoConCatalogo`) y los que solo muestran una parte —las ventas por categoría/sección, el Consolidado—, que así no arman el reporte
 * entero (margen Real, IPC, tendencia de precios, impacto de recetas…) para tirar casi todo (O.38/O.39 de docs/pureza-integracion.md). Mismas lecturas, en el
 * mismo orden, que el principio del reporte completo.
 */
export async function cargarLineasDelPeriodo(
  sucursalId: string,
  desdeIn: Date,
  hastaIn: Date,
  filtros: FiltrosPeriodo = {},
  db: Db,
  /**
   * Lo que quien llama ya leyó, para no volver a leerlo: la clasificación de «No comestibles» y el catálogo crudo (los mismos para todas las sucursales:
   * el Consolidado los lee una vez) y los Precios Locales vigentes de ESTA sucursal (ver `construirMapaProductos`).
   */
  cargado: { clasificacion?: ClasificacionNoComestibles; catalogo?: CatalogoDeProductos; preciosLocales?: ReadonlyMap<string, { precio: number }> } = {}
) {
  const { desde, hasta } = rangoUtc(desdeIn, hastaIn);

  // Optimización (Pivote 5, docs/auditoria-motor2-pivotes-2026-09-16.md
  // §11 Plan 3): el filtro de fecha/sección/producto/proceso YA estaba en
  // el WHERE (no era el defecto acá) — lo que dominaba el tiempo con
  // rangos amplios era el costo de hidratar cada fila con el `include`
  // completo (Producto/Seccion/Operacion+Proveedor enteros), no la
  // consulta SQL en sí (confirmada rápida con EXPLAIN ANALYZE). Un
  // `select` acotado a las columnas que el `.map()` de abajo realmente
  // usa reduce ese costo de hidratación sin cambiar ninguna fila
  // devuelta ni el resultado final.
  const movimientos = await db.movimientoStock.findMany({
    where: {
      seccion: { sucursalId },
      operacion: { fecha: { gte: desde, lte: hasta } },
      ...(filtros.proceso ? { proceso: filtros.proceso } : {}),
      ...(filtros.seccionId ? { seccionId: filtros.seccionId } : {}),
      ...(filtros.productoId ? { productoId: filtros.productoId } : {}),
    },
    select: {
      id: true,
      productoId: true,
      detalle: true,
      cantidad: true,
      loteVencimiento: true,
      proceso: true,
      seccionId: true,
      operacionId: true,
      precioTotal: true,
      precioPorUnidadStock: true,
      costoUnitarioVenta: true,
      producto: { select: { nombre: true, codigo: true } },
      seccion: { select: { nombre: true } },
      operacion: { select: { fecha: true, nroFactura: true, proveedorId: true, anuladaEn: true, proveedor: { select: { nombre: true } } } },
    },
    orderBy: { operacion: { fecha: "asc" } },
  });

  const items: ItemPeriodo[] = movimientos.map((m) => ({
    fecha: m.operacion.fecha,
    productoId: m.productoId,
    productoNombre: m.producto.nombre,
    productoCodigo: m.producto.codigo,
    detalle: m.detalle,
    // Magnitud (no el delta firmado) para los procesos de signo fijo — la
    // columna "Cantidad" de la Hoja 7 original también guardaba una
    // magnitud sin signo para estos casos (el signo se aplicaba solo al
    // sumar stock, nunca acá). Ajuste/Control/Transferencia SÍ quedan con
    // su delta firmado tal cual, mismo criterio que el original.
    cantidad: esSignoFijo(m.proceso) ? Math.abs(Number(m.cantidad)) : Number(m.cantidad),
    loteVencimiento: m.loteVencimiento,
    proveedorNombre: m.operacion.proveedor?.nombre ?? null,
    proveedorId: m.operacion.proveedorId,
    nroFactura: m.operacion.nroFactura,
    proceso: m.proceso,
    seccionId: m.seccionId,
    seccionNombre: m.seccion.nombre,
    idMovimiento: m.id,
    idOperacion: m.operacionId,
    precioTotal: Number(m.precioTotal),
    precioPorUnidadStock: Number(m.precioPorUnidadStock),
    costoUnitarioVenta: m.costoUnitarioVenta !== null ? Number(m.costoUnitarioVenta) : null,
    anulada: m.operacion.anuladaEn !== null,
  }));

  const clasificacionNoComestibles = cargado.clasificacion ?? (await cargarClasificacionNoComestibles(db));
  const productos = await construirMapaProductos(sucursalId, db, clasificacionNoComestibles, { catalogo: cargado.catalogo, preciosLocales: cargado.preciosLocales });
  return { desde, hasta, items, productos, clasificacionNoComestibles };
}

/**
 * Lo mismo que `obtenerReportePorPeriodo`, pero además devuelve el catálogo de productos que el reporte YA cargó, para que Promociones y
 * Categorías —que necesitan el mismo mapa— no lo vuelvan a leer (hacían 2 consultas `producto.findMany` por reporte en vez de 1). El mapa va
 * APARTE del reporte, no adentro: un `Map` dentro de un objeto de reporte se rompe (error de serialización) en cuanto alguien lo pasa
 * entero a un Client Component, y así la forma pública del reporte no cambia. `ahora` obligatorio (D.3b): ver `obtenerReportePorPeriodo`.
 */
export async function obtenerReportePorPeriodoConCatalogo(sucursalId: string, desdeIn: Date, hastaIn: Date, filtros: FiltrosPeriodo = {}, db: Db, ahora: Date) {
  // Los Precios Locales vigentes de la sucursal, UNA vez: los usan el mapa de productos (el `precioVenta` resuelto) y la comparativa de precios
  // (qué cambio de precio cuenta), y antes cada uno los leía con su capacidad por su cuenta (O.39 de docs/pureza-integracion.md).
  const preciosLocales = await preciosLocalesVigentes(sucursalId, db);
  const { desde, hasta, items, productos, clasificacionNoComestibles } = await cargarLineasDelPeriodo(sucursalId, desdeIn, hastaIn, filtros, db, { preciosLocales });

  const resumen: Record<string, number> = {};
  for (const it of items) resumen[it.proceso] = (resumen[it.proceso] ?? 0) + 1;

  // Una sola carga del catálogo para todo el reporte: se pasa como parámetro a TODAS las funciones de abajo que lo necesitan. Antes
  // tres de ellas (impacto de recetas, margen nominal y margen Real reconstruido) volvían a cargarlo por su cuenta: 4 consultas
  // `producto.findMany` por reporte en vez de 1. Lo fija test/reportes/catalogo-una-sola-carga.test.ts — si se suma una función que use
  // el catálogo, hay que pasárselo acá (recibirlo es opcional, así que olvidarlo NO da error: da una consulta de más, y ese test avisa).
  // El Consolidado ya no pasa por acá (O.38): arma solo lo que muestra con `cargarLineasDelPeriodo`, con el catálogo crudo leído una vez
  // para todas las sucursales y el mapa armado por sucursal (`precioVenta` sale resuelto con el Precio Local de CADA una). Promociones y
  // Categorías toman este mismo mapa del reporte (`obtenerReportePorPeriodoConCatalogo`) en vez de armar el suyo: también 1 por reporte.
  // Mismo criterio para el índice de recetas y la clasificación de "No comestibles": impacto de recetas, ratio Compras/Ventas, margen
  // nominal y margen Real reconstruido lo necesitaban cada uno por su cuenta (3 `recetaVersion.findMany` + 2 `grupo.findMany` por
  // reporte) — hallazgo de revisar el pendiente "consultas repetidas en reportes de recetas/grupos" (docs/p2109.md §4, nunca
  // confirmado hasta ahora). Se cargan acá una sola vez, igual que el catálogo. Y lo mismo, desde O.39, para la serie del IPC (margen y
  // comparativa la leían cada uno) y el costo de reposición de HOY (impacto de recetas, margen y alerta de margen objetivo: 3 lecturas).
  const [indiceRecetas, serieIPC, costosActuales] = await Promise.all([construirIndiceRecetas(db, sucursalId), cargarSerieIPC(db), obtenerCostoActualPorMP(sucursalId, db)]);
  const ventas = calcularVentasDelPeriodo(items, productos);
  const compras = calcularComprasDelPeriodo(items, productos);
  const gastoPorInsumo = calcularGastoPorInsumoDelPeriodo(items, productos);
  const ratioGastoVentas = await calcularRatioGastoVentas(sucursalId, desde, hasta, compras.totalGastado, compras.totalNoComestibles, ventas.totalFacturado, productos, db, clasificacionNoComestibles);
  const tendenciaPrecios = await calcularTendenciaPreciosDelPeriodo(sucursalId, desde, items, productos, db);
  const impactoRecetas = await calcularImpactoRecetasPorPeriodo(sucursalId, desde, db, productos, indiceRecetas, clasificacionNoComestibles, costosActuales);
  const margen = await calcularMargenDelPeriodo(sucursalId, items, ventas, db, productos, ahora, indiceRecetas, { serieIPC, costosActuales });
  const comparativaPrecios = await calcularComparativaPreciosDelPeriodo(sucursalId, desde, hasta, tendenciaPrecios, ventas.porProducto, db, ahora, { preciosLocales, serieIPC });
  // Alerta pasiva de margen objetivo: solo si la empresa cargó un objetivo (si no, no se calcula nada de más). Reusa el catálogo y el índice de recetas ya cargados.
  const objetivos = await cargarObjetivosDeMargen(db);
  const fueraDeObjetivo = hayObjetivosCargados(objetivos) ? resumirFueraDeObjetivo(await calcularCostosYMargenes(sucursalId, db, productos, indiceRecetas, objetivos, costosActuales)) : null;
  const digest = generarDigestAlertas(ratioGastoVentas, gastoPorInsumo, tendenciaPrecios, impactoRecetas, fueraDeObjetivo);

  const reporte = {
    total: items.length,
    items,
    resumen,
    desde,
    hasta,
    ventas,
    compras,
    gastoPorInsumo,
    ratioGastoVentas,
    tendenciaPrecios,
    impactoRecetas,
    comparativaPrecios,
    digest,
    margen,
  };
  return { reporte, productos };
}

/**
 * Port de generarReporteVentasPorCategoria (Reportes.js:243-283) — reusa
 * calcularVentasDelPeriodo (vía cargarLineasDelPeriodo) en vez de
 * reimplementar el criterio real-vs-estimado, solo reagrupa por Categoría.
 */
export async function generarReporteVentasPorCategoria(sucursalId: string, desde: Date, hasta: Date, db: Db) {
  // Solo las ventas: las líneas y el catálogo (`cargarLineasDelPeriodo`) y las mismas ventas que el reporte del período (`calcularVentasDelPeriodo`, que
  // descarta las anuladas con `r.anulada`), sin armar el resto del reporte que acá no se muestra (O.39: 21 consultas antes, la mayoría para tirar).
  const { desde: desdeRango, hasta: hastaRango, items, productos } = await cargarLineasDelPeriodo(sucursalId, desde, hasta, { proceso: "VENTA" }, db);
  const ventas = calcularVentasDelPeriodo(items, productos);

  return {
    desde: desdeRango,
    hasta: hastaRango,
    totalFacturado: ventas.totalFacturado,
    aviso: ventas.aviso,
    porCategoria: agruparVentasPorCategoria(ventas.porProducto.map((v) => ({ ...v, categoria: productos.get(v.productoId)?.categoriaNombre ?? null }))),
    pvSinCategoria: pvSinCategoriaDe(productos),
  };
}