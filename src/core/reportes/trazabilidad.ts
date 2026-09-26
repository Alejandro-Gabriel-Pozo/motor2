import { prisma } from "@/lib/db";
import type { Db } from "./comun";

export interface ItemOperacion {
  productoNombre: string;
  productoCodigo: string;
  detalle: string;
  cantidad: number;
  loteVencimiento: Date | null;
  proceso: string;
  seccionNombre: string;
  idMovimiento: string;
  /** D6 (docs/plan-sustitucion-insumos-receta-2026-09-26.md): solo en un CONSUMO que salió de un insumo SUSTITUTO — el nombre del
   * producto de la receta al que reemplazó. Null en todo lo demás (incluido un consumo de un hermano del mismo Insumo). */
  sustituyeANombre: string | null;
}

export interface DatosOperacion {
  idOperacion: string;
  fecha: Date;
  proceso: string;
  proveedorNombre: string | null;
  nroFactura: string | null;
  total: number;
  items: ItemOperacion[];
  /** Null = vigente. Hoy solo se anulan las ventas (ver anularVenta, server/actions/venta.ts), pero se informa para cualquier proceso. */
  anuladaEn: Date | null;
  anuladaPorEmail: string | null;
}

/**
 * Port de obtenerOperacionPorId (Reportes.js:1133-1165) — a diferencia del
 * original (rescanear Historial filtrando por texto), acá es 1 query por
 * la PK real. Se acota a `sucursalId` a propósito (huella nueva respecto a
 * Apps Script, donde cada hostería ya era un spreadsheet separado — acá
 * todas comparten la misma base): nunca se debe poder traer la operación
 * de otra sucursal solo adivinando/probando un ID.
 */
export async function obtenerOperacionPorId(sucursalId: string, idOperacion: string, db: Db = prisma): Promise<DatosOperacion | null> {
  const operacion = await db.operacion.findFirst({
    where: { id: idOperacion, sucursalId },
    include: { proveedor: true, anuladaPor: true, movimientos: { include: { producto: true, seccion: true, sustituyeAProducto: { select: { nombre: true } } } } },
  });
  if (!operacion) return null;

  return {
    idOperacion: operacion.id,
    fecha: operacion.fecha,
    proceso: operacion.proceso,
    proveedorNombre: operacion.proveedor?.nombre ?? null,
    nroFactura: operacion.nroFactura,
    total: operacion.movimientos.length,
    anuladaEn: operacion.anuladaEn,
    anuladaPorEmail: operacion.anuladaPor?.email ?? null,
    items: operacion.movimientos.map((m) => ({
      productoNombre: m.producto.nombre,
      productoCodigo: m.producto.codigo,
      detalle: m.detalle,
      cantidad: Number(m.cantidad),
      loteVencimiento: m.loteVencimiento,
      proceso: m.proceso,
      seccionNombre: m.seccion.nombre,
      idMovimiento: m.id,
      sustituyeANombre: m.sustituyeAProducto?.nombre ?? null,
    })),
  };
}

export interface OperacionEncontrada {
  idOperacion: string;
  fecha: Date;
  proceso: string;
  seccionNombre: string;
}

/** Port de buscarOperacionesPorProducto (Reportes.js:1178-1197). */
export async function buscarOperacionesPorProducto(sucursalId: string, termino: string, db: Db = prisma): Promise<OperacionEncontrada[]> {
  const q = termino.trim();
  if (!q) return [];

  const movimientos = await db.movimientoStock.findMany({
    where: {
      seccion: { sucursalId },
      producto: { OR: [{ nombre: { contains: q, mode: "insensitive" } }, { codigo: { contains: q, mode: "insensitive" } }] },
    },
    select: { operacionId: true, proceso: true, seccion: { select: { nombre: true } }, operacion: { select: { fecha: true } } },
    orderBy: { operacion: { fecha: "desc" } },
    distinct: ["operacionId"],
    take: 50,
  });

  return movimientos.map((m) => ({ idOperacion: m.operacionId, fecha: m.operacion.fecha, proceso: m.proceso, seccionNombre: m.seccion.nombre }));
}
