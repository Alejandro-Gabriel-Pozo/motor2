import type { Db } from "@/lib/db-tipos";
import type { DatosOperacion, OperacionEncontrada } from "@/core/reportes/public";

/**
 * Port de obtenerOperacionPorId (Reportes.js:1133-1165) — a diferencia del
 * original (rescanear Historial filtrando por texto), acá es 1 query por
 * la PK real. Se acota a `sucursalId` a propósito (huella nueva respecto a
 * Apps Script, donde cada hostería ya era un spreadsheet separado — acá
 * todas comparten la misma base): nunca se debe poder traer la operación
 * de otra sucursal solo adivinando/probando un ID.
 */
export async function obtenerOperacionPorId(sucursalId: string, idOperacion: string, db: Db): Promise<DatosOperacion | null> {
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

/** Port de buscarOperacionesPorProducto (Reportes.js:1178-1197). */
export async function buscarOperacionesPorProducto(sucursalId: string, termino: string, db: Db): Promise<OperacionEncontrada[]> {
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