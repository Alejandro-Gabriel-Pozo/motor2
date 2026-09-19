import { prisma } from "@/lib/db";
import type { Proceso } from "@prisma/client";
import { esSignoFijo, redondearMoneda } from "@/core/movimientos/transiciones";
import { construirMapaProductos, redondearCantidad, type Db, type InfoProductoReporte } from "./comun";
import { calcularCostosYMargenes, calcularImpactoRecetasPorPeriodo, type FilaImpactoRecetaPorPeriodo } from "./costos";
import { claveCostoHistorico, diaUtc, reconstruirCostosDeVenta } from "./costo-historico";
import { resolverAccionFaltante, type AccionFaltante } from "./accion-faltante";
import { cargarSerieIPC, esMesSinPublicar, resolverCoeficienteIPC, resolverVariacionPeriodoIPC } from "./indices-economicos";

export interface FiltrosPeriodo {
  proceso?: Proceso;
  seccionId?: string;
  productoId?: string;
}

export interface ItemPeriodo {
  fecha: Date;
  productoId: string;
  productoNombre: string;
  productoCodigo: string;
  detalle: string;
  cantidad: number;
  loteVencimiento: Date | null;
  proveedorNombre: string | null;
  nroFactura: string | null;
  proceso: Proceso;
  seccionId: string;
  seccionNombre: string;
  idMovimiento: string;
  idOperacion: string;
  precioTotal: number;
  precioPorUnidadStock: number;
  /** Solo proceso VENTA, desde 2026-09-17 — ver docstring en schema.prisma (MovimientoStock.costoUnitarioVenta). */
  costoUnitarioVenta: number | null;
}

/**
 * Rango inclusivo [desde 00:00, hasta 23:59:59.999] — en UTC, no en la hora
 * local del proceso Node. `desde`/`hasta` llegan como Date "de solo día"
 * (`new Date('yyyy-MM-dd')` del lado del cliente, mismo patrón que ya usa
 * el resto del proyecto — ver venta-form.tsx/reclasificar-form.tsx): ese
 * constructor SIEMPRE interpreta el string como medianoche UTC, sin
 * importar la zona horaria del navegador. El bug que Apps Script arrastraba
 * (Reportes.js:41-48, parsearFechaLocal_) salía de comparar esa medianoche
 * UTC contra un `setHours(0,0,0,0)` que corre en la zona LOCAL del
 * script — acá se evita de raíz usando `setUTCHours` en vez de `setHours`,
 * así el límite del rango se calcula con el mismo criterio (UTC) que ya se
 * usó para construir el valor, sin depender de en qué TZ corra el server.
 */
function rangoUtc(desde: Date, hasta: Date): { desde: Date; hasta: Date } {
  const d = new Date(desde);
  d.setUTCHours(0, 0, 0, 0);
  const h = new Date(hasta);
  h.setUTCHours(23, 59, 59, 999);
  return { desde: d, hasta: h };
}

/**
 * Port de obtenerReportePorPeriodo (Reportes.js:30-109) — a diferencia del
 * original (rescanear la hoja Historial entera y filtrar en memoria), acá
 * el filtro de fecha/sección/producto/proceso ya va en el WHERE de
 * Postgres; el resultado sigue siendo "1 fila = 1 línea de Kardex" porque
 * varios reportes (CSV, margen, compras) necesitan ese detalle línea por
 * línea, no un agregado.
 */
export async function obtenerReportePorPeriodo(sucursalId: string, desdeIn: Date, hastaIn: Date, filtros: FiltrosPeriodo = {}, db: Db = prisma) {
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
      operacion: { select: { fecha: true, nroFactura: true, proveedor: { select: { nombre: true } } } },
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
    nroFactura: m.operacion.nroFactura,
    proceso: m.proceso,
    seccionId: m.seccionId,
    seccionNombre: m.seccion.nombre,
    idMovimiento: m.id,
    idOperacion: m.operacionId,
    precioTotal: Number(m.precioTotal),
    precioPorUnidadStock: Number(m.precioPorUnidadStock),
    costoUnitarioVenta: m.costoUnitarioVenta !== null ? Number(m.costoUnitarioVenta) : null,
  }));

  const resumen: Record<string, number> = {};
  for (const it of items) resumen[it.proceso] = (resumen[it.proceso] ?? 0) + 1;

  const ventas = await calcularVentasDelPeriodo(sucursalId, items, db);
  const compras = calcularComprasDelPeriodo(items);
  const gastoPorInsumo = await calcularGastoPorInsumoDelPeriodo(sucursalId, items, db);
  const ratioGastoVentas = await calcularRatioGastoVentas(sucursalId, desde, hasta, compras.totalGastado, ventas.totalFacturado, db);
  const tendenciaPrecios = await calcularTendenciaPreciosDelPeriodo(sucursalId, desde, items, db);
  const impactoRecetas = await calcularImpactoRecetasPorPeriodo(sucursalId, desde, db);
  const margen = await calcularMargenDelPeriodo(sucursalId, items, ventas, db);
  const comparativaPrecios = await calcularComparativaPreciosDelPeriodo(desde, hasta, tendenciaPrecios, ventas.porProducto, db);
  const digest = generarDigestAlertas(ratioGastoVentas, gastoPorInsumo, tendenciaPrecios, impactoRecetas);

  return {
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
}

export interface FilaAlertaDigest {
  texto: string;
  severidad: "alta" | "media";
}

/**
 * Resumen de hasta 5 alertas fijas, siempre visibles arriba del reporte —
 * paso 3 del grounding (segunda pasada, docs/grounding-reportes-compras-
 * 2026-09-18.md §5): "un dueño de pizzería chica no configura umbrales ni
 * lee mails de su ERP" — nada de esto es configurable ni es una
 * notificación aparte, es pura síntesis de lo que las funciones de arriba
 * YA calcularon (no dispara ninguna consulta nueva). Orden fijo por
 * prioridad: primero lo que pone en duda los datos (sospechoso), después
 * lo que más plata movió, después a qué plato le pegó más, después la
 * tendencia general, y por último contexto de concentración — se recorta
 * a 5 aunque hubiera más candidatos.
 */
function generarDigestAlertas(
  ratioGastoVentas: RatioGastoVentas,
  gastoPorInsumo: GastoPorInsumoDelPeriodo,
  tendenciaPrecios: FilaPrecioInsumo[],
  impactoRecetas: FilaImpactoRecetaPorPeriodo[]
): FilaAlertaDigest[] {
  const alertas: FilaAlertaDigest[] = [];

  const sospechosos = tendenciaPrecios.filter((f) => f.sospechoso);
  if (sospechosos.length === 1) {
    const s = sospechosos[0]!;
    alertas.push({
      severidad: "alta",
      texto: `Revisá la carga de "${s.insumo}": el precio cambió ${s.deltaPct! > 0 ? "+" : ""}${s.deltaPct}% de golpe — más probable un error de carga (unidad/presentación) que una suba real.`,
    });
  } else if (sospechosos.length > 1) {
    alertas.push({
      severidad: "alta",
      texto: `Revisá la carga de ${sospechosos.length} insumos con cambios de precio poco creíbles (más de 200%) — más probable un error de carga que subas reales.`,
    });
  }

  const conImpacto = tendenciaPrecios.filter((f) => f.deltaImpacto !== null && f.deltaImpacto !== 0);
  if (conImpacto.length > 0) {
    const top = conImpacto[0]!; // ya viene ordenado por |impacto| desde calcularTendenciaPreciosDelPeriodo
    const sube = top.deltaImpacto! > 0;
    alertas.push({
      severidad: sube ? "alta" : "media",
      texto: `"${top.insumo}" es lo que más ${sube ? "te encareció" : "te abarató"} las compras: ${sube ? "+" : ""}$${top.deltaImpacto!.toLocaleString("es-AR")} (${top.deltaPct! > 0 ? "+" : ""}${top.deltaPct}%) sobre lo que compraste este período.`,
    });
  }

  if (impactoRecetas.length > 0) {
    const plato = impactoRecetas[0]!; // ya viene ordenado por |deltaCosto| desde calcularImpactoRecetasPorPeriodo
    const pctTexto = plato.foodCostPctAntes !== null && plato.foodCostPctActual !== null ? ` (food cost ${plato.foodCostPctAntes}% → ${plato.foodCostPctActual}%)` : "";
    alertas.push({
      severidad: plato.deltaCosto > 0 ? "alta" : "media",
      texto: `El plato más golpeado por estos cambios es "${plato.productoNombre}": costo ${plato.deltaCosto > 0 ? "+" : ""}$${plato.deltaCosto.toLocaleString("es-AR")}${pctTexto}.`,
    });
  }

  if (ratioGastoVentas.porcentaje !== null && ratioGastoVentas.porcentajePeriodoAnterior !== null) {
    const diferencia = Math.round((ratioGastoVentas.porcentaje - ratioGastoVentas.porcentajePeriodoAnterior) * 10) / 10;
    if (Math.abs(diferencia) >= 3) {
      alertas.push({
        severidad: diferencia > 0 ? "alta" : "media",
        texto: `Compras/Ventas ${diferencia > 0 ? "subió" : "bajó"} de ${ratioGastoVentas.porcentajePeriodoAnterior}% a ${ratioGastoVentas.porcentaje}% respecto al período anterior.`,
      });
    }
  }

  if (alertas.length < 5 && gastoPorInsumo.porInsumo.length >= 3) {
    const corte80 = gastoPorInsumo.porInsumo.findIndex((f) => f.porcentajeAcumulado >= 80);
    if (corte80 >= 0 && corte80 + 1 < gastoPorInsumo.porInsumo.length) {
      alertas.push({
        severidad: "media",
        texto: `${corte80 + 1} de ${gastoPorInsumo.porInsumo.length} insumos concentran el 80% de lo que gastaste en Compras este período.`,
      });
    }
  }

  return alertas.slice(0, 5);
}

export interface RatioGastoVentas {
  porcentaje: number | null;
  porcentajePeriodoAnterior: number | null;
  aviso: string;
}

/**
 * "Food cost %" del período (Compras / Ventas), comparado contra el mismo
 * cálculo del período INMEDIATO ANTERIOR de igual duración — paso 0 del
 * grounding (docs/grounding-reportes-compras-2026-09-18.md §5, sugerido en
 * la segunda pasada como más barato y más prioritario que el paso 1 ya
 * implementado: los dos totales ya están calculados en esta misma
 * función, solo falta la comparación).
 *
 * Deliberadamente NO es "food cost" real (consumo/ventas) — es
 * DESEMBOLSO/ventas: una compra grande de stockeo sube este número sin
 * que haya más consumo real ese mismo período. El aviso lo dice explícito
 * (mismo criterio de honestidad que `hayComprasSinPrecio`) en vez de
 * nombrarlo "food cost" y dejar que se lea como un dato que no es.
 */
async function calcularRatioGastoVentas(
  sucursalId: string,
  desde: Date,
  hasta: Date,
  totalGastado: number,
  totalFacturado: number,
  db: Db
): Promise<RatioGastoVentas> {
  const duracionMs = hasta.getTime() - desde.getTime();
  const hastaAnterior = new Date(desde.getTime() - 1);
  const desdeAnterior = new Date(hastaAnterior.getTime() - duracionMs);

  const filas = await db.movimientoStock.groupBy({
    by: ["proceso"],
    where: { seccion: { sucursalId }, operacion: { fecha: { gte: desdeAnterior, lte: hastaAnterior } }, proceso: { in: ["COMPRA", "VENTA"] } },
    _sum: { precioTotal: true },
  });
  const comprasAnterior = Number(filas.find((f) => f.proceso === "COMPRA")?._sum.precioTotal ?? 0);
  const ventasAnterior = Number(filas.find((f) => f.proceso === "VENTA")?._sum.precioTotal ?? 0);

  const calcular = (gastado: number, facturado: number) => (facturado > 0 ? Math.round((gastado / facturado) * 1000) / 10 : null);

  return {
    porcentaje: calcular(totalGastado, totalFacturado),
    porcentajePeriodoAnterior: calcular(comprasAnterior, ventasAnterior),
    aviso: "Compras ÷ Ventas del período — mide desembolso, no consumo real: una compra grande para stockear sube este número sin que se haya consumido más. Sirve para ver la tendencia, no como food cost exacto.",
  };
}

export interface FilaCompraPorProveedorProducto {
  nombre: string;
  importe: number;
}
export interface FilaCompraPorProveedor {
  proveedor: string;
  importe: number;
  lineas: number;
  productos: FilaCompraPorProveedorProducto[];
}
export interface ComprasDelPeriodo {
  totalGastado: number;
  porProveedor: FilaCompraPorProveedor[];
  hayComprasSinPrecio: boolean;
  aviso: string;
}

/**
 * Port de calcularComprasDelPeriodo_ (Reportes.js:128-169). A diferencia de
 * Ventas no hace falta un fallback "estimado": el Precio Total de una línea
 * de Compra siempre es el importe real de esa factura puntual (o 0 si se
 * cargó sin precio — campo opcional).
 */
function calcularComprasDelPeriodo(items: ItemPeriodo[]): ComprasDelPeriodo {
  const porProveedor = new Map<string, { importe: number; lineas: number; productos: Map<string, number> }>();
  let totalGastado = 0;
  let hayComprasSinPrecio = false;

  for (const r of items) {
    if (r.proceso !== "COMPRA") continue;
    const proveedor = r.proveedorNombre || "Sin proveedor";
    const importe = r.precioTotal;
    if (importe <= 0) hayComprasSinPrecio = true;
    totalGastado += importe;

    if (!porProveedor.has(proveedor)) porProveedor.set(proveedor, { importe: 0, lineas: 0, productos: new Map() });
    const acc = porProveedor.get(proveedor)!;
    acc.importe += importe;
    acc.lineas += 1;
    acc.productos.set(r.productoNombre, (acc.productos.get(r.productoNombre) ?? 0) + importe);
  }

  const porProveedorLista = Array.from(porProveedor.entries())
    .map(([proveedor, v]) => ({
      proveedor,
      importe: redondearMoneda(v.importe),
      lineas: v.lineas,
      productos: Array.from(v.productos.entries())
        .map(([nombre, importe]) => ({ nombre, importe: redondearMoneda(importe) }))
        .sort((a, b) => b.importe - a.importe),
    }))
    .sort((a, b) => b.importe - a.importe);

  return {
    totalGastado: redondearMoneda(totalGastado),
    porProveedor: porProveedorLista,
    hayComprasSinPrecio,
    aviso: hayComprasSinPrecio
      ? "Incluye compras cargadas sin Precio Total (el campo es opcional): esas suman $0 al total gastado."
      : "Importe real de cada compra (Precio Total cargado al registrarla).",
  };
}

export interface FilaGastoPorInsumo {
  insumo: string;
  grupo: string | null;
  importe: number;
  /** % de este insumo sobre el total gastado en Compras del período. */
  porcentaje: number;
  /** % acumulado hasta esta fila (la lista ya viene ordenada de mayor a menor importe) — para el corte 80/20: dónde el acumulado cruza 80% son los insumos que de verdad importan (segunda pasada del grounding, docs/grounding-reportes-compras-2026-09-18.md §5). */
  porcentajeAcumulado: number;
  /** Cantidad de líneas de compra de este insumo (frecuencia de reposición — a diferencia de "líneas" por proveedor, acá sí es una señal útil: reponer seguido un mismo insumo a varios proveedores distintos sugiere consolidar). */
  cantidadCompras: number;
  proveedores: string[];
}
export interface FilaGastoPorGrupo {
  grupo: string;
  importe: number;
}
export interface GastoPorInsumoDelPeriodo {
  porInsumo: FilaGastoPorInsumo[];
  porGrupo: FilaGastoPorGrupo[];
}

/**
 * "¿En qué se me va la plata?" — agrupa el mismo gasto de Compras por
 * INSUMO (y por Grupo/familia), no por proveedor. Hallazgo de grounding
 * (docs/grounding-reportes-compras-2026-09-18.md, paso 1, inspirado en el
 * reporte "Spendings" de Grocy): agrupar solo por proveedor responde una
 * pregunta contable ("cuánto le debo a X"), no la pregunta de gestión
 * real. Reusa `construirMapaProductos` (ya resuelve Insumo/Grupo por
 * producto) en vez de duplicar esa resolución acá.
 */
async function calcularGastoPorInsumoDelPeriodo(sucursalId: string, items: ItemPeriodo[], db: Db): Promise<GastoPorInsumoDelPeriodo> {
  const productos = await construirMapaProductos(sucursalId, db);
  const porInsumo = new Map<string, { grupo: string | null; importe: number; cantidadCompras: number; proveedores: Set<string> }>();
  const porGrupo = new Map<string, number>();

  for (const r of items) {
    if (r.proceso !== "COMPRA") continue;
    const info = productos.get(r.productoId);
    const insumo = info?.insumoNombre ?? "Sin insumo asignado";
    const grupo = info?.grupoNombre ?? null;
    const importe = r.precioTotal;

    if (!porInsumo.has(insumo)) porInsumo.set(insumo, { grupo, importe: 0, cantidadCompras: 0, proveedores: new Set() });
    const acc = porInsumo.get(insumo)!;
    acc.importe += importe;
    acc.cantidadCompras += 1;
    if (r.proveedorNombre) acc.proveedores.add(r.proveedorNombre);

    const claveGrupo = grupo ?? "Sin categoría";
    porGrupo.set(claveGrupo, (porGrupo.get(claveGrupo) ?? 0) + importe);
  }

  const totalGastadoInsumos = Array.from(porInsumo.values()).reduce((acc, v) => acc + v.importe, 0);
  let acumulado = 0;
  const porInsumoLista = Array.from(porInsumo.entries())
    .map(([insumo, v]) => ({ insumo, grupo: v.grupo, importe: v.importe, cantidadCompras: v.cantidadCompras, proveedores: Array.from(v.proveedores).sort() }))
    .sort((a, b) => b.importe - a.importe)
    .map((f) => {
      acumulado += f.importe;
      return {
        ...f,
        importe: redondearMoneda(f.importe),
        porcentaje: totalGastadoInsumos > 0 ? Math.round((f.importe / totalGastadoInsumos) * 1000) / 10 : 0,
        porcentajeAcumulado: totalGastadoInsumos > 0 ? Math.round((acumulado / totalGastadoInsumos) * 1000) / 10 : 0,
      };
    });

  const porGrupoLista = Array.from(porGrupo.entries())
    .map(([grupo, importe]) => ({ grupo, importe: redondearMoneda(importe) }))
    .sort((a, b) => b.importe - a.importe);

  return { porInsumo: porInsumoLista, porGrupo: porGrupoLista };
}

export interface FilaPrecioInsumo {
  insumo: string;
  grupo: string | null;
  /** $ por unidad de stock, promedio ponderado por cantidad de las compras del período. */
  precioUnitarioPromedio: number;
  cantidadComprada: number;
  /** Precio unitario de la última Compra de este insumo ANTES de que empezara el período — null si nunca se compró antes (primera vez) o esa compra no tenía precio real. */
  precioUnitarioAnterior: number | null;
  deltaPct: number | null;
  /** (precioUnitarioPromedio - precioUnitarioAnterior) × cantidadComprada — lo que realmente costó (o ahorró) el cambio de precio, a la cantidad que efectivamente se compró. Esto es lo que ordena la lista, no el %. */
  deltaImpacto: number | null;
  /** |deltaPct| pasa un umbral poco creíble para una suba real de precio — más probable un error de carga (unidad/presentación mal tipeada) que una suba genuina. Se muestra igual, marcado, en vez de ocultarlo o de tratarlo como un hecho. */
  sospechoso: boolean;
}

const UMBRAL_VARIACION_SOSPECHOSA_PCT = 200;

/**
 * Precio anterior a `desde` de cada insumo — el más reciente de TODAS sus
 * Compras previas (cualquier producto de ese Insumo), sin importar cuánto
 * tiempo pasó. Una sola consulta ordenada por fecha desc + quedarse con la
 * primera aparición de cada insumo en JS (evita 1 query por insumo).
 */
async function obtenerPrecioAnteriorPorInsumo(
  sucursalId: string,
  desde: Date,
  productos: Map<string, InfoProductoReporte>,
  insumosDelPeriodo: Set<string>,
  db: Db
): Promise<Map<string, number>> {
  const productoIdsRelevantes = Array.from(productos.entries())
    .filter(([, info]) => info.insumoNombre && insumosDelPeriodo.has(info.insumoNombre))
    .map(([id]) => id);
  if (!productoIdsRelevantes.length) return new Map();

  const previas = await db.movimientoStock.findMany({
    where: { productoId: { in: productoIdsRelevantes }, proceso: "COMPRA", seccion: { sucursalId }, operacion: { fecha: { lt: desde } } },
    select: { productoId: true, precioTotal: true, cantidad: true },
    orderBy: { operacion: { fecha: "desc" } },
  });

  const precioAnteriorPorInsumo = new Map<string, number>();
  for (const m of previas) {
    const insumo = productos.get(m.productoId)?.insumoNombre;
    if (!insumo || precioAnteriorPorInsumo.has(insumo)) continue; // ya se guardó la más reciente de ese insumo (viene ordenado desc)
    const cantidad = Number(m.cantidad);
    const precioTotal = Number(m.precioTotal);
    if (cantidad > 0 && precioTotal > 0) precioAnteriorPorInsumo.set(insumo, precioTotal / cantidad);
  }
  return precioAnteriorPorInsumo;
}

/**
 * "¿Estoy pagando más que antes?" — paso 2 del grounding (segunda pasada,
 * docs/grounding-reportes-compras-2026-09-18.md §5): a diferencia de una
 * primera versión que hubiera ordenado por % de variación, esto ordena
 * por IMPACTO EN $ (Δprecio × cantidad comprada) — un insumo barato que
 * sube 60% puede pesar menos que uno caro que sube 7%, y el % solo
 * confunde esa comparación. Excluye "Sin insumo asignado" a propósito:
 * promediar el precio de productos sin relación entre sí no tiene
 * sentido (a diferencia de `calcularGastoPorInsumoDelPeriodo`, que sí
 * necesita un bucket para eso porque ahí solo suma $, no compara precios).
 */
async function calcularTendenciaPreciosDelPeriodo(sucursalId: string, desde: Date, items: ItemPeriodo[], db: Db): Promise<FilaPrecioInsumo[]> {
  const productos = await construirMapaProductos(sucursalId, db);
  const porInsumo = new Map<string, { grupo: string | null; sumaPrecioTotal: number; sumaCantidad: number }>();

  for (const r of items) {
    if (r.proceso !== "COMPRA") continue;
    if (!(r.cantidad > 0) || r.precioTotal <= 0) continue; // sin cantidad o sin precio no aporta un precio unitario real
    const info = productos.get(r.productoId);
    const insumo = info?.insumoNombre;
    if (!insumo) continue;

    if (!porInsumo.has(insumo)) porInsumo.set(insumo, { grupo: info.grupoNombre, sumaPrecioTotal: 0, sumaCantidad: 0 });
    const acc = porInsumo.get(insumo)!;
    acc.sumaPrecioTotal += r.precioTotal;
    acc.sumaCantidad += r.cantidad;
  }

  const preciosAnteriores = await obtenerPrecioAnteriorPorInsumo(sucursalId, desde, productos, new Set(porInsumo.keys()), db);

  const filas: FilaPrecioInsumo[] = Array.from(porInsumo.entries()).map(([insumo, v]) => {
    const precioUnitarioPromedio = redondearMoneda(v.sumaPrecioTotal / v.sumaCantidad);
    const precioUnitarioAnterior = preciosAnteriores.get(insumo) ?? null;

    let deltaPct: number | null = null;
    let deltaImpacto: number | null = null;
    let sospechoso = false;
    if (precioUnitarioAnterior !== null && precioUnitarioAnterior > 0) {
      deltaPct = Math.round(((precioUnitarioPromedio - precioUnitarioAnterior) / precioUnitarioAnterior) * 1000) / 10;
      deltaImpacto = redondearMoneda((precioUnitarioPromedio - precioUnitarioAnterior) * v.sumaCantidad);
      sospechoso = Math.abs(deltaPct) > UMBRAL_VARIACION_SOSPECHOSA_PCT;
    }

    return {
      insumo,
      grupo: v.grupo,
      precioUnitarioPromedio,
      cantidadComprada: redondearCantidad(v.sumaCantidad),
      precioUnitarioAnterior: precioUnitarioAnterior !== null ? redondearMoneda(precioUnitarioAnterior) : null,
      deltaPct,
      deltaImpacto,
      sospechoso,
    };
  });

  filas.sort((a, b) => Math.abs(b.deltaImpacto ?? 0) - Math.abs(a.deltaImpacto ?? 0));
  return filas;
}

export interface ComparativaPreciosDelPeriodo {
  /** Variación agregada ponderada por $ comprado de `tendenciaPrecios` (excluye insumos `sospechoso`: distorsionarían el agregado con lo que probablemente es un error de carga). */
  variacionInsumosPct: number | null;
  /** Variación de `Producto.precioVenta` registrada en RegistroAuditoria durante el período, ponderada por lo facturado en el período de esos mismos productos. */
  variacionCartaPropiaPct: number | null;
  cantidadProductosConCambioCarta: number;
  /** IPC GBA Nivel General (INDEC) del mismo período — contexto de inflación general, no del rubro. */
  variacionIPCPct: number | null;
  aviso: string;
  avisoCarta: string;
  avisoIPC: string;
}

/**
 * "¿Tu carta acompaña estos cambios?" — paso 5 del grounding (segunda
 * pasada, docs/grounding-reportes-compras-2026-09-18.md §5): compara la
 * suba de insumos (ya calculada arriba, ponderada por $) contra dos
 * referencias — la PRIMARIA es el propio historial de precios de venta del
 * negocio (índice de carta propio, vía RegistroAuditoria — Pivote 6), la
 * SECUNDARIA/contextual es el IPC general del mismo período. La primaria
 * importa más: compararte contra vos mismo (¿ajustaste la carta al ritmo
 * de tus costos?) es una pregunta más accionable que compararte contra un
 * promedio nacional que no sabe qué vendés.
 */
async function calcularComparativaPreciosDelPeriodo(
  desde: Date,
  hasta: Date,
  tendenciaPrecios: FilaPrecioInsumo[],
  ventasPorProducto: FilaVentaProducto[],
  db: Db
): Promise<ComparativaPreciosDelPeriodo> {
  let sumaDeltaInsumos = 0;
  let sumaBaseInsumos = 0;
  for (const f of tendenciaPrecios) {
    if (f.precioUnitarioAnterior === null || f.precioUnitarioAnterior <= 0 || f.sospechoso) continue;
    sumaDeltaInsumos += (f.precioUnitarioPromedio - f.precioUnitarioAnterior) * f.cantidadComprada;
    sumaBaseInsumos += f.precioUnitarioAnterior * f.cantidadComprada;
  }
  const variacionInsumosPct = sumaBaseInsumos > 0 ? Math.round((sumaDeltaInsumos / sumaBaseInsumos) * 1000) / 10 : null;

  const cambiosCarta = await db.registroAuditoria.findMany({
    where: { entidad: "Producto", campo: "precioVenta", creadoEn: { gte: desde, lte: hasta } },
    orderBy: { creadoEn: "asc" },
    select: { entidadId: true, valorAnterior: true, valorNuevo: true },
  });
  // Una sola fila por producto: el primer `valorAnterior` y el último
  // `valorNuevo` del período (vienen ordenados asc) — así 2+ cambios del
  // mismo producto en el período no se cuentan por separado, se ve el
  // cambio NETO del período.
  const porProductoCarta = new Map<string, { primero: number | null; ultimo: number }>();
  for (const c of cambiosCarta) {
    const nuevo = c.valorNuevo !== null ? Number(c.valorNuevo) : NaN;
    if (Number.isNaN(nuevo)) continue;
    const anterior = c.valorAnterior !== null ? Number(c.valorAnterior) : NaN;
    const existente = porProductoCarta.get(c.entidadId);
    if (!existente) porProductoCarta.set(c.entidadId, { primero: Number.isNaN(anterior) ? null : anterior, ultimo: nuevo });
    else existente.ultimo = nuevo;
  }

  const importePorProducto = new Map(ventasPorProducto.map((v) => [v.productoId, v.importe]));
  let sumaPonderadaCarta = 0;
  let sumaPesoCarta = 0;
  let cantidadProductosConCambioCarta = 0;
  for (const [productoId, { primero, ultimo }] of porProductoCarta) {
    if (primero === null || primero <= 0) continue;
    cantidadProductosConCambioCarta++;
    const peso = importePorProducto.get(productoId) ?? 0;
    if (peso > 0) {
      sumaPonderadaCarta += ((ultimo - primero) / primero) * 100 * peso;
      sumaPesoCarta += peso;
    }
  }
  const variacionCartaPropiaPct = sumaPesoCarta > 0 ? Math.round((sumaPonderadaCarta / sumaPesoCarta) * 10) / 10 : null;

  const serieIPC = await cargarSerieIPC(db);
  const variacionIPCPct = resolverVariacionPeriodoIPC(desde, hasta, serieIPC);

  return {
    variacionInsumosPct,
    variacionCartaPropiaPct,
    cantidadProductosConCambioCarta,
    variacionIPCPct,
    aviso: "Compara cuánto subieron tus insumos (ponderado por lo que realmente compraste) contra cuánto ajustaste tu propia carta y contra la inflación general — para ver si la carta está acompañando el costo, no solo si subió.",
    avisoCarta:
      variacionCartaPropiaPct !== null
        ? "Ponderado por lo facturado en el período de los productos con cambio de precio de venta registrado (RegistroAuditoria)."
        : cantidadProductosConCambioCarta > 0
          ? "Hubo cambios de precio de venta registrados en el período, pero ninguno de esos productos se vendió en este mismo período — no hay base para ponderar."
          : "Todavía no hay cambios de precio de venta registrados en este período (el registro de auditoría arrancó el 2026-09-18) — este comparador mejora con el uso.",
    avisoIPC:
      variacionIPCPct !== null
        ? `IPC GBA Nivel General (INDEC) del mismo período — contexto de inflación general, no del rubro gastronómico específico.${esMesSinPublicar(hasta, serieIPC) || esMesSinPublicar(desde, serieIPC) ? ` PROVISORIO: el INDEC todavía no publicó el mes del período; se usó ${serieIPC.ultimoMes}, el último disponible.` : ""}`
        : esMesSinPublicar(desde, serieIPC)
          ? "El INDEC todavía no publicó el IPC de este período (lo publica a mitad del mes siguiente): la inflación se va a poder medir cuando salga."
          : "Sin IPC sincronizado para alguno de los dos meses del período.",
  };
}

export interface FilaVentaProducto {
  productoId: string;
  producto: string;
  cantidad: number;
  importe: number;
  precioUnitario: number;
  estimado: boolean;
}
export interface VentasDelPeriodo {
  totalFacturado: number;
  porProducto: FilaVentaProducto[];
  aviso: string;
}

/**
 * Port de calcularVentasDelPeriodo_ (Reportes.js:190-229). Una línea con
 * Precio Total > 0 es el importe REAL de esa venta puntual; una con 0 es
 * una venta vieja sin precio guardado por línea y se estima al precio de
 * venta VIGENTE (ya resuelto con Precio Local — ver construirMapaProductos)
 * — marcada `estimado` para que la UI no la confunda con un importe real.
 */
async function calcularVentasDelPeriodo(sucursalId: string, items: ItemPeriodo[], db: Db): Promise<VentasDelPeriodo> {
  const productos = await construirMapaProductos(sucursalId, db);
  const porProducto = new Map<string, { producto: string; cantidad: number; importe: number; precioUnitario: number; estimado: boolean }>();
  let totalFacturado = 0;

  for (const r of items) {
    if (r.proceso !== "VENTA") continue;
    const esReal = r.precioTotal > 0;
    const precioVentaVigente = productos.get(r.productoId)?.precioVenta ?? 0;
    const importe = esReal ? r.precioTotal : r.cantidad * precioVentaVigente;
    const precioUnitario = esReal ? r.precioPorUnidadStock : precioVentaVigente;
    totalFacturado += importe;

    if (!porProducto.has(r.productoId)) porProducto.set(r.productoId, { producto: r.productoNombre, cantidad: 0, importe: 0, precioUnitario, estimado: false });
    const acc = porProducto.get(r.productoId)!;
    acc.cantidad += r.cantidad;
    acc.importe += importe;
    acc.precioUnitario = precioUnitario;
    if (!esReal) acc.estimado = true;
  }

  const hayEstimados = Array.from(porProducto.values()).some((v) => v.estimado);

  return {
    totalFacturado: redondearMoneda(totalFacturado),
    porProducto: Array.from(porProducto.entries())
      .map(([productoId, v]) => ({ productoId, ...v, cantidad: redondearCantidad(v.cantidad), importe: redondearMoneda(v.importe) }))
      .sort((a, b) => b.importe - a.importe),
    aviso: hayEstimados
      ? "Incluye ventas cargadas ANTES de guardar el precio real por línea: se valorizan al precio de venta VIGENTE hoy (marcadas como estimadas)."
      : "Importe real registrado en cada venta (no una estimación).",
  };
}

export interface FilaMargenProducto {
  productoId: string;
  producto: string;
  cantidad: number;
  ingreso: number;
  ingresoEstimado: boolean;
  costoUnitario: number | null;
  costo: number | null;
  costoIncompleto: boolean;
  /** docs/comparativa-ux-erpnext-dolibarr.md §7.1 — mismo criterio causa→acción que ya usaba Costos, ahora compartido. `null` si no falta nada. */
  accionFaltante: AccionFaltante | null;
  margen: number | null;
  margenPct: number | null;
}
export interface MargenDelPeriodo {
  ingresoTotal: number;
  costoTotal: number;
  margenTotal: number;
  margenPctTotal: number | null;
  hayCostoIncompleto: boolean;
  porProducto: FilaMargenProducto[];
  aviso: string;
  /**
   * "Margen real" (docs/comparativa-ux-erpnext-dolibarr.md §9) — a
   * diferencia de margenTotal (receta/costo de HOY aplicados a TODO lo
   * vendido en el rango), esto suma, línea por línea, el costo que
   * MovimientoStock.costoUnitarioVenta congeló en el momento exacto de esa
   * venta. Solo cubre ventas registradas desde que existe ese campo
   * (2026-09-17) — `ingresoSinCostoReal` es cuánto del ingreso del rango
   * quedó afuera por no tener ese dato (ventas viejas, o costeo incompleto
   * ese día). `null` si NINGUNA venta del rango tiene el dato todavía.
   */
  margenRealTotal: number | null;
  margenRealPctTotal: number | null;
  ingresoConCostoReal: number;
  ingresoSinCostoReal: number;
  /** Parte de `ingresoConCostoReal` cuyo costo se RECONSTRUYÓ con el historial de compras (la venta no lo guardó al venderse). */
  ingresoRealReconstruido: number;
  avisoReal: string;
  /**
   * "Margen ajustado por IPC" (Método 1, docs/comparativa-ux-erpnext-
   * dolibarr.md §10) — lleva el ingreso de cada venta a poder adquisitivo
   * del último mes con IPC cargado (`indices-economicos.ts`) ANTES de
   * restarle el costo de HOY (el mismo costoPorProducto que usa
   * margenTotal, a propósito: acá los dos lados de la resta quedan en la
   * misma "moneda" — plata de hoy — a diferencia de margenTotal, que
   * mezcla ingreso histórico nominal con costo de hoy). A diferencia de
   * margenRealTotal, SÍ es retroactivo — el INDEC tiene el índice de
   * cualquier mes pasado — pero depende de que ese mes ya esté
   * sincronizado (`sincronizarIPC`) y de que el producto tenga costo
   * completo hoy. `ingresoSinIPC` es cuánto del ingreso del rango quedó
   * afuera (mes sin IPC publicado/sincronizado, o costo incompleto).
   */
  margenIPCTotal: number | null;
  margenIPCPctTotal: number | null;
  ingresoAjustadoIPCTotal: number;
  ingresoConIPC: number;
  ingresoSinIPC: number;
  /** Cuánto del ingreso con IPC es de un mes que el INDEC todavía no publicó (coeficiente provisorio). */
  ingresoProvisorioIPC: number;
  avisoIPC: string;
}

/**
 * Port de calcularMargenDelPeriodo_ (Reportes.js:304-352). LIMITACIÓN a
 * propósito (igual que el original): el costo usa la receta y los precios
 * de insumos de HOY, no los que regían cuando se vendió cada unidad. Ver
 * `margenRealTotal` para la alternativa que no tiene este descalce
 * temporal (a costo de solo cubrir ventas recientes).
 */
async function calcularMargenDelPeriodo(sucursalId: string, items: ItemPeriodo[], ventasDelPeriodo: VentasDelPeriodo, db: Db): Promise<MargenDelPeriodo> {
  const costos = await calcularCostosYMargenes(sucursalId, db);
  const costoPorProducto = new Map(costos.map((c) => [c.productoId, c]));

  let costoTotal = 0;
  let hayCostoIncompleto = false;

  const porProducto: FilaMargenProducto[] = ventasDelPeriodo.porProducto
    .map((v) => {
      const infoCosto = costoPorProducto.get(v.productoId);
      const costoUnitario = infoCosto && !infoCosto.costoIncompleto ? Number(infoCosto.costo ?? 0) : null;
      const costoLinea = costoUnitario === null ? null : redondearMoneda(costoUnitario * v.cantidad);

      if (costoLinea === null) hayCostoIncompleto = true;
      else costoTotal += costoLinea;

      const margen = costoLinea === null ? null : redondearMoneda(v.importe - costoLinea);

      return {
        productoId: v.productoId,
        producto: v.producto,
        cantidad: v.cantidad,
        ingreso: v.importe,
        ingresoEstimado: v.estimado,
        costoUnitario: costoUnitario === null ? null : redondearMoneda(costoUnitario),
        costo: costoLinea,
        costoIncompleto: costoLinea === null,
        accionFaltante: infoCosto ? resolverAccionFaltante(infoCosto) : null,
        margen,
        margenPct: margen !== null && v.importe > 0 ? Math.round((margen / v.importe) * 1000) / 10 : null,
      };
    })
    .sort((a, b) => (b.margen ?? -Infinity) - (a.margen ?? -Infinity));

  const ingresoTotal = ventasDelPeriodo.totalFacturado;
  const margenTotal = redondearMoneda(ingresoTotal - costoTotal);

  // Margen real: línea por línea (no por producto agregado, a diferencia de
  // arriba) porque dos ventas del MISMO producto en fechas distintas pueden
  // tener costoUnitarioVenta distinto si la receta cambió entre medio.
  let ingresoConCostoReal = 0;
  let costoRealTotal = 0;
  let ingresoSinCostoReal = 0;
  let ingresoRealReconstruido = 0;
  // Las ventas que no guardaron su costo al venderse (cargadas sin ese dato) se intentan costear al día de la venta con el historial
  // de compras (ver costo-historico.ts); las que no se pueden costear quedan en `ingresoSinCostoReal`.
  const ventasSinCosto = items.filter((it) => it.proceso === "VENTA" && it.costoUnitarioVenta === null);
  const costosReconstruidos = await reconstruirCostosDeVenta(sucursalId, ventasSinCosto, db);
  for (const it of items) {
    if (it.proceso !== "VENTA") continue;
    if (it.costoUnitarioVenta !== null) {
      ingresoConCostoReal += it.precioTotal;
      costoRealTotal += it.cantidad * it.costoUnitarioVenta;
      continue;
    }
    const reconstruido = costosReconstruidos.get(claveCostoHistorico(it.productoId, diaUtc(it.fecha))) ?? null;
    if (reconstruido !== null) {
      ingresoConCostoReal += it.precioTotal;
      ingresoRealReconstruido += it.precioTotal;
      costoRealTotal += it.cantidad * reconstruido;
    } else {
      ingresoSinCostoReal += it.precioTotal;
    }
  }
  const hayCostoReal = ingresoConCostoReal > 0;
  const margenRealTotal = hayCostoReal ? redondearMoneda(ingresoConCostoReal - costoRealTotal) : null;

  // Margen ajustado por IPC: también línea por línea (cada venta puede
  // caer en un mes distinto, con coeficiente distinto) — mismo
  // costoPorProducto (costo de HOY) que usa el margen nominal arriba, a
  // propósito: acá se ajusta el ingreso para que los dos lados de la
  // resta queden en plata de hoy.
  const serieIPC = await cargarSerieIPC(db);
  let ingresoAjustadoIPCTotal = 0;
  let costoIPCTotal = 0;
  let ingresoConIPC = 0;
  let ingresoSinIPC = 0;
  let ingresoProvisorioIPC = 0; // ingreso de meses que el INDEC todavía no publicó (coeficiente provisorio, ver resolverCoeficienteIPC)
  for (const it of items) {
    if (it.proceso !== "VENTA" || it.precioTotal <= 0) continue;
    const infoCosto = costoPorProducto.get(it.productoId);
    const costoUnitario = infoCosto && !infoCosto.costoIncompleto ? Number(infoCosto.costo ?? 0) : null;
    const coeficiente = resolverCoeficienteIPC(it.fecha, serieIPC);
    if (costoUnitario === null || coeficiente === null) {
      ingresoSinIPC += it.precioTotal;
      continue;
    }
    ingresoAjustadoIPCTotal += it.precioTotal * coeficiente;
    costoIPCTotal += it.cantidad * costoUnitario;
    ingresoConIPC += it.precioTotal;
    if (esMesSinPublicar(it.fecha, serieIPC)) ingresoProvisorioIPC += it.precioTotal;
  }
  const margenIPCTotal = ingresoConIPC > 0 ? redondearMoneda(ingresoAjustadoIPCTotal - costoIPCTotal) : null;

  return {
    ingresoTotal,
    costoTotal: redondearMoneda(costoTotal),
    margenTotal,
    margenPctTotal: ingresoTotal > 0 ? Math.round((margenTotal / ingresoTotal) * 1000) / 10 : null,
    hayCostoIncompleto,
    porProducto,
    aviso:
      "Costo calculado con la receta y el costo de reposición VIGENTES hoy (mismo criterio que Costos y Márgenes), no con los que regían en el momento de cada venta."
      + (hayCostoIncompleto ? " Algunos productos vendidos no tienen costo completo y quedan afuera del costo/margen total." : ""),
    margenRealTotal,
    margenRealPctTotal: margenRealTotal !== null && ingresoConCostoReal > 0 ? Math.round((margenRealTotal / ingresoConCostoReal) * 1000) / 10 : null,
    ingresoConCostoReal: redondearMoneda(ingresoConCostoReal),
    ingresoSinCostoReal: redondearMoneda(ingresoSinCostoReal),
    ingresoRealReconstruido: redondearMoneda(ingresoRealReconstruido),
    avisoReal: hayCostoReal
      ? `Costo de la receta al día de cada venta (sin el descalce temporal de "Margen" arriba).${
          ingresoRealReconstruido > 0
            ? ` RECONSTRUIDO: $${redondearMoneda(ingresoRealReconstruido).toLocaleString("es-AR")} de lo vendido no guardó su costo al venderse y se lo calculó con el historial de compras (el precio de la compra más reciente de cada insumo hasta ese día) y la receta de hoy: es una aproximación.`
            : ""
        }${ingresoSinCostoReal > 0 ? ` No se pudo costear $${redondearMoneda(ingresoSinCostoReal).toLocaleString("es-AR")} (algún insumo sin compras hasta ese día, o el plato sin receta).` : ""}`
      : "No hay ventas que se puedan costear al día de la venta (ninguna guardó su costo y falta el historial de compras de algún insumo).",
    margenIPCTotal,
    margenIPCPctTotal: margenIPCTotal !== null && ingresoAjustadoIPCTotal > 0 ? Math.round((margenIPCTotal / ingresoAjustadoIPCTotal) * 1000) / 10 : null,
    ingresoAjustadoIPCTotal: redondearMoneda(ingresoAjustadoIPCTotal),
    ingresoConIPC: redondearMoneda(ingresoConIPC),
    ingresoSinIPC: redondearMoneda(ingresoSinIPC),
    ingresoProvisorioIPC: redondearMoneda(ingresoProvisorioIPC),
    avisoIPC: ingresoConIPC > 0
      ? `Ventas llevadas a poder adquisitivo de hoy (IPC INDEC) antes de restar el costo de reposición de HOY — los dos lados de la resta quedan en la misma plata, a diferencia de "Margen".${ingresoSinIPC > 0 ? ` Cubre $${redondearMoneda(ingresoConIPC).toLocaleString("es-AR")} de $${ingresoTotal.toLocaleString("es-AR")} — el resto es de un producto con costo incompleto o de un mes que falta en la serie del IPC.` : ""}${ingresoProvisorioIPC > 0 ? ` PROVISORIO: $${redondearMoneda(ingresoProvisorioIPC).toLocaleString("es-AR")} son de un mes que el INDEC todavía no publicó; se los trata como hechos en ${serieIPC.ultimoMes} (el último publicado), sin inflación entre medio. Se corrige solo cuando se publique.` : ""}`
      : "Todavía no hay índice de IPC sincronizado (o ninguna venta del rango cae en un mes ya sincronizado).",
  };
}

export interface FilaCategoriaVenta {
  categoria: string;
  cantidad: number;
  importe: number;
  productos: { producto: string; cantidad: number; importe: number }[];
}

/**
 * Port de generarReporteVentasPorCategoria (Reportes.js:243-283) — reusa
 * calcularVentasDelPeriodo (vía obtenerReportePorPeriodo) en vez de
 * reimplementar el criterio real-vs-estimado, solo reagrupa por Categoría.
 */
export async function generarReporteVentasPorCategoria(sucursalId: string, desde: Date, hasta: Date, db: Db = prisma) {
  const rep = await obtenerReportePorPeriodo(sucursalId, desde, hasta, { proceso: "VENTA" }, db);
  const productos = await construirMapaProductos(sucursalId, db);

  const porCategoria = new Map<string, { cantidad: number; importe: number; productos: { producto: string; cantidad: number; importe: number }[] }>();
  for (const v of rep.ventas.porProducto) {
    const categoria = productos.get(v.productoId)?.categoriaNombre ?? "Sin categoría";
    if (!porCategoria.has(categoria)) porCategoria.set(categoria, { cantidad: 0, importe: 0, productos: [] });
    const acc = porCategoria.get(categoria)!;
    acc.cantidad += v.cantidad;
    acc.importe += v.importe;
    acc.productos.push({ producto: v.producto, cantidad: v.cantidad, importe: v.importe });
  }

  const pvSinCategoria = Array.from(productos.values())
    .filter((p) => p.tipo === "PV" && p.activo && !p.categoriaNombre)
    .map((p) => p.nombre)
    .sort((a, b) => a.localeCompare(b));

  return {
    desde: rep.desde,
    hasta: rep.hasta,
    totalFacturado: rep.ventas.totalFacturado,
    aviso: rep.ventas.aviso,
    porCategoria: Array.from(porCategoria.entries())
      .map(([categoria, c]) => ({ categoria, cantidad: redondearCantidad(c.cantidad), importe: redondearMoneda(c.importe), productos: c.productos.sort((a, b) => b.importe - a.importe) }))
      .sort((a, b) => b.importe - a.importe),
    pvSinCategoria,
  };
}

/** Port de resumenPeriodicoPorProceso (Reportes.js:517-531). */
export async function resumenPeriodicoPorProceso(sucursalId: string, desde: Date, hasta: Date, db: Db = prisma) {
  const rep = await obtenerReportePorPeriodo(sucursalId, desde, hasta, {}, db);
  const totales: Record<string, number> = {};
  for (const r of rep.items) totales[r.proceso] = (totales[r.proceso] ?? 0) + r.cantidad;
  return { totalMovimientos: rep.total, totalesPorProceso: totales };
}
