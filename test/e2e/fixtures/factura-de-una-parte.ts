import { randomUUID } from "node:crypto";
import { prisma } from "./db";
import { prismaAdmin } from "../../setup/cliente-duenio";
import { normalizarNumeroDeComprobante } from "../../../src/core/compras/public";

/**
 * Siembra, directo en la base, una compra como la guarda el sistema desde U1 de «una sola compra»: una FACTURA (cabecera + un renglón de mercadería) con UNA parte (la compra de la sucursal y su línea de Kardex, que apunta al renglón).
 * Los specs de «Compras registradas» (anular, corregir, estado de pago) parten de acá en vez de sembrar una compra suelta (la que ya no existe en el producto). `limpiar` borra TODO lo que sembró, en orden de claves foráneas.
 */
export interface FacturaDeUnaParteSembrada {
  facturaId: string;
  operacionId: string;
  renglonId: string;
}

export async function sembrarFacturaDeUnaParte(p: {
  sucursalId: string;
  seccionId: string;
  proveedorId: string;
  productoId: string;
  usuarioId: string;
  nroFactura: string;
  detalleLibre?: string;
  cantidad?: number;
  precioTotal?: number;
  fecha?: Date;
  condicionPago?: "CONTADO_PAGADA" | "PENDIENTE_DE_PAGO";
}): Promise<FacturaDeUnaParteSembrada> {
  const fecha = p.fecha ?? new Date("2026-08-10T12:00:00Z");
  const cantidad = p.cantidad ?? 12;
  const precioTotal = p.precioTotal ?? 360;
  const factura = await prisma.facturaProveedor.create({
    data: {
      proveedorId: p.proveedorId, nroFactura: p.nroFactura, nroFacturaNormalizado: normalizarNumeroDeComprobante(p.nroFactura), detalleLibre: p.detalleLibre ?? null, fecha, importeTotal: precioTotal.toFixed(2), estado: "CONFIRMADA", confirmadaEn: fecha, confirmadaPorId: p.usuarioId,
      origen: "CARGA", condicionPago: p.condicionPago ?? "CONTADO_PAGADA", claveIdempotencia: randomUUID(), payloadHash: "huella-e2e", resultadoMensaje: "Compra registrada.", creadoPorId: p.usuarioId,
    } as never,
  });
  const renglon = await prisma.facturaProveedorRenglon.create({
    data: { facturaProveedorId: factura.id, orden: 1, naturaleza: "MERCADERIA", productoId: p.productoId, cantidadStock: String(cantidad), precioPorUnidadStock: (precioTotal / cantidad).toFixed(4), detalle: "Compra", precioTotal: precioTotal.toFixed(2) } as never,
  });
  const operacion = await prisma.operacion.create({
    data: { sucursalId: p.sucursalId, proceso: "COMPRA", fecha, proveedorId: p.proveedorId, nroFactura: p.nroFactura, detalleLibre: p.detalleLibre ?? null, usuarioId: p.usuarioId },
  });
  await prisma.movimientoStock.create({
    data: { operacionId: operacion.id, productoId: p.productoId, seccionId: p.seccionId, proceso: "COMPRA", cantidad, precioTotal, precioPorUnidadStock: precioTotal / cantidad, detalle: "Compra", facturaProveedorRenglonId: renglon.id },
  });
  await prisma.facturaProveedorSucursal.create({ data: { facturaProveedorId: factura.id, sucursalId: p.sucursalId, porcentajeDeclaradoBp: 10000, operacionId: operacion.id } });
  return { facturaId: factura.id, operacionId: operacion.id, renglonId: renglon.id };
}

/** Borra la factura sembrada con sus partes, renglones, anulaciones, pagos y auditoría (no toca el Kardex ni las operaciones: las limpia el spec, que las conoce). */
export async function borrarFacturaSembrada(facturaIds: string[]): Promise<void> {
  if (!facturaIds.length) return;
  await prismaAdmin.registroAuditoria.deleteMany({ where: { entidad: "FacturaProveedor", entidadId: { in: facturaIds } } });
  await prismaAdmin.anulacionDePagoDeFacturaProveedor.deleteMany({ where: { pago: { facturaProveedorId: { in: facturaIds } } } });
  await prismaAdmin.pagoDeFacturaProveedor.deleteMany({ where: { facturaProveedorId: { in: facturaIds } } });
  await prismaAdmin.anulacionDeFacturaProveedor.deleteMany({ where: { facturaProveedorId: { in: facturaIds } } });
  await prismaAdmin.facturaProveedorSucursal.deleteMany({ where: { facturaProveedorId: { in: facturaIds } } });
}

/** Segundo paso del borrado, DESPUÉS de borrar el Kardex y las operaciones: los renglones y la cabecera (el Kardex apunta al renglón y la operación a la parte). */
export async function borrarCabeceraSembrada(facturaIds: string[]): Promise<void> {
  if (!facturaIds.length) return;
  await prismaAdmin.facturaProveedorRenglon.deleteMany({ where: { facturaProveedorId: { in: facturaIds } } });
  await prismaAdmin.facturaProveedor.deleteMany({ where: { id: { in: facturaIds } } });
}
