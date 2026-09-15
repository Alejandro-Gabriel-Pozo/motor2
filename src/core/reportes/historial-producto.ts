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

  const [movimientos, conteos] = await Promise.all([
    db.movimientoStock.findMany({
      where: { productoId, seccion: { sucursalId }, ...(seccionId ? { seccionId } : {}) },
      include: { seccion: true, operacion: { include: { proveedor: true } } },
    }),
    db.conteoFisico.findMany({
      where: { productoId, sucursalId, ...(seccionId ? { seccionId } : {}) },
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

  // Orden cronológico ASCENDENTE de TODO el historial real (sin recortar
  // por fecha todavía) — el saldo corriente arranca del primer movimiento.
  const timeline = [...eventosMovimiento, ...eventosConteo].sort((a, b) => a.fecha.getTime() - b.fecha.getTime());

  let saldo = 0;
  for (const ev of timeline) {
    if (ev.tipo !== "movimiento") continue;
    saldo += ev.cantidadConSigno!;
    ev.saldoCorriente = redondearCantidad(saldo);
  }

  // Recién ACÁ se recorta por el rango pedido — el saldoCorriente de cada
  // evento ya quedó calculado sobre el historial completo.
  const eventosVisibles = timeline.filter((ev) => {
    if (desde && ev.fecha < desde) return false;
    if (hasta) {
      const finDia = new Date(hasta);
      finDia.setUTCHours(23, 59, 59, 999);
      if (ev.fecha > finDia) return false;
    }
    return true;
  });

  return {
    productoId: producto.id,
    codigo: producto.codigo,
    producto: producto.nombre,
    tipo: producto.tipo,
    unidadStockNombre: producto.unidadStock.nombre,
    saldoActual: redondearCantidad(saldo),
    eventos: eventosVisibles,
    totalMovimientos: eventosMovimiento.length,
    totalConteos: eventosConteo.length,
  };
}
