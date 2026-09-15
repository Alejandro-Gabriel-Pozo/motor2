import { prisma } from "@/lib/db";
import type { Proceso } from "@prisma/client";
import { esSignoFijo, redondearMoneda } from "@/core/movimientos/transiciones";
import { construirMapaProductos, redondearCantidad, type Db } from "./comun";
import { calcularCostosYMargenes } from "./costos";

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

  const movimientos = await db.movimientoStock.findMany({
    where: {
      seccion: { sucursalId },
      operacion: { fecha: { gte: desde, lte: hasta } },
      ...(filtros.proceso ? { proceso: filtros.proceso } : {}),
      ...(filtros.seccionId ? { seccionId: filtros.seccionId } : {}),
      ...(filtros.productoId ? { productoId: filtros.productoId } : {}),
    },
    include: { producto: true, seccion: true, operacion: { include: { proveedor: true } } },
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
  }));

  const resumen: Record<string, number> = {};
  for (const it of items) resumen[it.proceso] = (resumen[it.proceso] ?? 0) + 1;

  const ventas = await calcularVentasDelPeriodo(sucursalId, items, db);
  const compras = calcularComprasDelPeriodo(items);
  const margen = await calcularMargenDelPeriodo(sucursalId, ventas, db);

  return { total: items.length, items, resumen, desde, hasta, ventas, compras, margen };
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
}

/**
 * Port de calcularMargenDelPeriodo_ (Reportes.js:304-352). LIMITACIÓN a
 * propósito (igual que el original): el costo usa la receta y los precios
 * de insumos de HOY, no los que regían cuando se vendió cada unidad.
 */
async function calcularMargenDelPeriodo(sucursalId: string, ventasDelPeriodo: VentasDelPeriodo, db: Db): Promise<MargenDelPeriodo> {
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
        margen,
        margenPct: margen !== null && v.importe > 0 ? Math.round((margen / v.importe) * 1000) / 10 : null,
      };
    })
    .sort((a, b) => (b.margen ?? -Infinity) - (a.margen ?? -Infinity));

  const ingresoTotal = ventasDelPeriodo.totalFacturado;
  const margenTotal = redondearMoneda(ingresoTotal - costoTotal);

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
