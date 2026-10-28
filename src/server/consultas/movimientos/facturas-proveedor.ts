import "server-only";
import type { Db } from "@/lib/db-tipos";

/**
 * E3a (ADR-041): lo que muestra la página de Compra de una sucursal sobre las facturas de proveedor repartidas. Solo lectura, con `select` (nunca la fila entera) y SIN NINGÚN CAMPO DE DINERO: el operario de la
 * sucursal destino ve solo productos y cantidades de su parte (decisión del dueño, 2026-10-28); los importes quedan con piso administrador (GT-1). Sin guarda de permiso adentro: la página ya pidió el «Ver» de
 * `proceso_compra` y pasa la sucursal del contexto; la RLS por sucursal deja ver una propuesta solo a sus dos puntas.
 */

export interface PropuestaParaAceptar {
  id: string;
  proveedorNombre: string;
  nroFactura: string | null;
  /** Fecha de la factura (mediodía argentino del día elegido por quien la cargó). */
  fechaFactura: Date;
  /** Desde qué sucursal la propusieron. */
  origenNombre: string;
  propuestaEn: Date;
  renglones: { productoNombre: string; unidadNombre: string; cantidadStock: number }[];
}

/** «Para aceptar»: las propuestas PENDIENTES cuyo destino es esta sucursal y cuya factura no está anulada, de la más vieja a la más nueva. */
export async function listarPropuestasParaAceptar(sucursalId: string, db: Db): Promise<PropuestaParaAceptar[]> {
  const filas = await db.facturaProveedorPropuesta.findMany({
    where: { destinoSucursalId: sucursalId, estado: "PENDIENTE", facturaProveedor: { anuladaEn: null } },
    select: {
      id: true,
      creadoEn: true,
      origenSucursal: { select: { nombre: true } },
      facturaProveedor: { select: { nroFactura: true, fecha: true, proveedor: { select: { nombre: true } } } },
      renglones: {
        select: { cantidadStock: true, renglon: { select: { orden: true, producto: { select: { nombre: true, unidadStock: { select: { nombre: true } } } } } } },
      },
    },
    orderBy: { creadoEn: "asc" },
  });
  return filas.map((f) => ({
    id: f.id,
    proveedorNombre: f.facturaProveedor.proveedor.nombre,
    nroFactura: f.facturaProveedor.nroFactura,
    fechaFactura: f.facturaProveedor.fecha,
    origenNombre: f.origenSucursal.nombre,
    propuestaEn: f.creadoEn,
    renglones: [...f.renglones]
      .sort((a, b) => a.renglon.orden - b.renglon.orden)
      .map((r) => ({ productoNombre: r.renglon.producto?.nombre ?? "", unidadNombre: r.renglon.producto?.unidadStock.nombre ?? "", cantidadStock: Number(r.cantidadStock) })),
  }));
}

export interface PropuestaEnviada {
  id: string;
  destinoNombre: string;
  proveedorNombre: string;
  nroFactura: string | null;
  propuestaEn: Date;
  /** Estado efectivo: la anulación de la factura marca las propuestas pendientes. */
  estado: "PENDIENTE" | "ACEPTADA" | "ANULADA";
  aceptadaEn: Date | null;
}

/** «Lo que cargué»: las propuestas que esta sucursal hizo a otras (las últimas `limite`), con su estado. Sin importes. */
export async function listarPropuestasEnviadas(sucursalId: string, db: Db, limite = 30): Promise<PropuestaEnviada[]> {
  const filas = await db.facturaProveedorPropuesta.findMany({
    where: { origenSucursalId: sucursalId },
    select: {
      id: true,
      creadoEn: true,
      estado: true,
      aceptadaEn: true,
      destinoSucursal: { select: { nombre: true } },
      facturaProveedor: { select: { nroFactura: true, anuladaEn: true, proveedor: { select: { nombre: true } } } },
    },
    orderBy: { creadoEn: "desc" },
    take: limite,
  });
  return filas.map((f) => ({
    id: f.id,
    destinoNombre: f.destinoSucursal.nombre,
    proveedorNombre: f.facturaProveedor.proveedor.nombre,
    nroFactura: f.facturaProveedor.nroFactura,
    propuestaEn: f.creadoEn,
    estado: f.estado === "ACEPTADA" ? "ACEPTADA" : f.facturaProveedor.anuladaEn ? "ANULADA" : "PENDIENTE",
    aceptadaEn: f.aceptadaEn,
  }));
}

/** Las OTRAS sucursales activas de la empresa (id y nombre), para elegir a quién proponer una parte. `Sucursal` es de gobierno: se lee sin alcance. */
export async function listarOtrasSucursalesParaReparto(sucursalId: string, db: Db): Promise<{ id: string; nombre: string }[]> {
  return db.sucursal.findMany({ where: { activo: true, NOT: { id: sucursalId } }, select: { id: true, nombre: true }, orderBy: { nombre: "asc" } });
}
