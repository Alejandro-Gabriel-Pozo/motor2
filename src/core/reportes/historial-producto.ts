import { prisma } from "@/lib/db";
import { redondearCantidad, type Db } from "./comun";

export interface FilaBusquedaProducto {
  productoId: string;
  codigo: string;
  nombre: string;
  tipo: "MP" | "PV";
  activo: boolean;
}

/**
 * Port de buscarProductoParaHistorial (Reportes.js:1217-1230) — a
 * diferencia de otros buscadores del proyecto (compra, conteo, precio
 * local), incluye INACTIVOS a propósito: se puede querer ver el historial
 * de algo que ya se discontinuó.
 */
export async function buscarProductoParaHistorial(termino: string, db: Db = prisma): Promise<FilaBusquedaProducto[]> {
  const q = termino.trim();
  const productos = await db.producto.findMany({
    where: q ? { OR: [{ nombre: { contains: q, mode: "insensitive" } }, { codigo: { contains: q, mode: "insensitive" } }] } : {},
    take: 20,
    orderBy: { nombre: "asc" },
  });
  return productos.map((p) => ({ productoId: p.id, codigo: p.codigo, nombre: p.nombre, tipo: p.tipo, activo: p.activo }));
}

export interface EventoHistorialProducto {
  tipo: "movimiento" | "conteo";
  fecha: Date;
  detalle: string;
  seccionNombre: string;
  // Solo `tipo === "movimiento"`:
  proceso?: string;
  loteVencimiento?: Date | null;
  proveedorNombre?: string | null;
  nroFactura?: string | null;
  idOperacion?: string;
  cantidadConSigno?: number;
  saldoCorriente?: number;
  // Solo `tipo === "conteo"`:
  saldoSistema?: number;
  conteoReal?: number;
  diferencia?: number;
  estado?: string;
}

export interface HistorialProducto {
  productoId: string;
  codigo: string;
  producto: string;
  tipo: "MP" | "PV";
  unidadStockNombre: string;
  saldoActual: number;
  eventos: EventoHistorialProducto[];
  totalMovimientos: number;
  totalConteos: number;
}

/**
 * Port de obtenerHistorialProducto (Reportes.js:1241-1331). `seccionId`
 * vacío = todas las secciones (el saldo corriente mezcla entradas/salidas
 * de todas, mismo criterio que Conteo Físico: sección opcional).
 * `desde`/`hasta` son SOLO para qué se MUESTRA: el saldo corriente siempre
 * arranca del primer movimiento real del producto, nunca se "resetea" a 0
 * en la fecha de inicio del filtro.
 *
 * A diferencia de Apps Script (que reconstruía el signo con
 * signoDeProceso_/esDeltaConSignoLibre_ al leer), acá `cantidad` ya viene
 * con el signo aplicado (ver docstring de MovimientoStock) — el saldo
 * corriente es, directo, la suma acumulada en orden cronológico.
 */
export async function obtenerHistorialProducto(
  sucursalId: string,
  productoId: string,
  seccionId: string | undefined,
  desde: Date | undefined,
  hasta: Date | undefined,
  db: Db = prisma
): Promise<HistorialProducto | null> {
  const producto = await db.producto.findUnique({ where: { id: productoId }, include: { unidadStock: true } });
  if (!producto) return null;

  const whereMov = { productoId, seccion: { sucursalId }, ...(seccionId ? { seccionId } : {}) };
  const whereConteo = { productoId, sucursalId, ...(seccionId ? { seccionId } : {}) };

  // Rango [desde 00:00, hasta 23:59:59.999] — mismo criterio UTC que
  // reportes/periodo.ts.
  const finDia = hasta ? new Date(hasta) : undefined;
  finDia?.setUTCHours(23, 59, 59, 999);
  const filtroFechaMov = desde || finDia ? { operacion: { fecha: { ...(desde ? { gte: desde } : {}), ...(finDia ? { lte: finDia } : {}) } } } : {};
  const filtroFechaConteo = desde || finDia ? { fecha: { ...(desde ? { gte: desde } : {}), ...(finDia ? { lte: finDia } : {}) } } : {};

  // Optimización (Pivote 5, docs/auditoria-motor2-pivotes-2026-09-16.md
  // §11 Plan 3): antes, esta función cargaba TODO el historial del
  // producto sin filtrar por fecha en la query, sin importar qué rango
  // pidiera el usuario — crecía sin límite con productos longevos. Ahora
  // el detalle SOLO trae lo que cae dentro de [desde,hasta] (si se pidió
  // alguno), y "saldoInicial" (agregado, no el detalle) captura el efecto
  // de todo lo anterior a `desde` — la cuenta final da EXACTO lo mismo que
  // sumar el historial completo hasta ese punto, sin cargarlo entero.
  // saldoActual/totalMovimientos/totalConteos siguen siendo el total real
  // (de siempre, no del rango) — invariante documentada arriba y en la UI
  // (reportes/historial/page.tsx: "no del rango elegido") — se calculan
  // aparte, sin filtro de fecha, nunca a partir del detalle recortado.
  const [saldoInicial, saldoActualAgg, totalMovimientos, totalConteos, movimientos, conteos] = await Promise.all([
    desde
      ? db.movimientoStock.aggregate({ where: { ...whereMov, operacion: { fecha: { lt: desde } } }, _sum: { cantidad: true } }).then((r) => Number(r._sum.cantidad ?? 0))
      : Promise.resolve(0),
    db.movimientoStock.aggregate({ where: whereMov, _sum: { cantidad: true } }).then((r) => Number(r._sum.cantidad ?? 0)),
    db.movimientoStock.count({ where: whereMov }),
    db.conteoFisico.count({ where: whereConteo }),
    db.movimientoStock.findMany({
      where: { ...whereMov, ...filtroFechaMov },
      include: { seccion: true, operacion: { include: { proveedor: true } } },
    }),
    db.conteoFisico.findMany({
      where: { ...whereConteo, ...filtroFechaConteo },
      include: { seccion: true },
    }),
  ]);

  const eventosMovimiento: EventoHistorialProducto[] = movimientos.map((m) => ({
    tipo: "movimiento",
    fecha: m.operacion.fecha,
    detalle: m.detalle,
    seccionNombre: m.seccion.nombre,
    proceso: m.proceso,
    loteVencimiento: m.loteVencimiento,
    proveedorNombre: m.operacion.proveedor?.nombre ?? null,
    nroFactura: m.operacion.nroFactura,
    idOperacion: m.operacionId,
    cantidadConSigno: Number(m.cantidad),
  }));

  const eventosConteo: EventoHistorialProducto[] = conteos.map((c) => ({
    tipo: "conteo",
    fecha: c.fecha,
    detalle: `Conteo físico: ${c.accion}${c.detalle ? " — " + c.detalle : ""}`,
    seccionNombre: c.seccion.nombre,
    saldoSistema: Number(c.saldoSistema),
    conteoReal: Number(c.conteoReal),
    diferencia: Number(c.diferencia),
    estado: c.estado,
  }));

  // Orden cronológico ASCENDENTE de lo que cae en el rango pedido — el
  // saldo corriente arranca de saldoInicial (todo lo anterior a `desde`
  // ya resumido en un número), nunca de 0.
  const eventosVisibles = [...eventosMovimiento, ...eventosConteo].sort((a, b) => a.fecha.getTime() - b.fecha.getTime());

  let saldo = saldoInicial;
  for (const ev of eventosVisibles) {
    if (ev.tipo !== "movimiento") continue;
    saldo += ev.cantidadConSigno!;
    ev.saldoCorriente = redondearCantidad(saldo);
  }

  return {
    productoId: producto.id,
    codigo: producto.codigo,
    producto: producto.nombre,
    tipo: producto.tipo,
    unidadStockNombre: producto.unidadStock.nombre,
    saldoActual: redondearCantidad(saldoActualAgg),
    eventos: eventosVisibles,
    totalMovimientos,
    totalConteos,
  };
}
