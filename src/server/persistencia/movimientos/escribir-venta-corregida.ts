import "server-only";
import type { Prisma } from "@prisma/client";
import type { LineaParaCorregir } from "@/core/movimientos/public";

/**
 * Escritura de la venta B que REEMPLAZA a una venta A corregida quitándole unidades (E1 de la corrección por ajuste, docs/diseno-correccion-por-ajuste-2026-11-06.md).
 * Mismo contrato que el resto de `server/persistencia/`: `tx` obligatorio, sin reglas de negocio. Solo AGREGA (el Kardex es append-only):
 *  1. la `Operacion` VENTA nueva, con `reemplazaAOperacionId` apuntando a A (índice único: una venta se reemplaza una sola vez, lo que arbitra la carrera de dos correcciones
 *     de la misma venta), con la MISMA fecha, cliente, sección, número de factura y detalle que A, y el mismo vendedor (`usuarioId` de A: los reportes por vendedor no se mueven;
 *     quién corrigió queda en el contra-asiento, la marca de A y la auditoría);
 *  2. sus filas de Kardex (`createMany`), las que armó `copiarVentaConMenosUnidades`.
 * No lleva `promoCuentaId` ni `operacionPadreId` (una promo y un adicional no se corrigen por unidades) ni `ventaId` (nadie escribe esa cabecera todavía).
 * Se llama DESPUÉS de marcar a A (`escribirContraAsiento`): si A tiene número de factura, el índice de factura única ya lo tiene libre.
 */
export interface VentaCorregidaAEscribir {
  ventaReemplazadaId: string;
  sucursalId: string;
  cabecera: {
    fecha: Date;
    clienteId: string | null;
    nroFactura: string | null;
    seccionDestinoId: string | null;
    detalleLibre: string | null;
    usuarioId: string;
  };
  lineas: readonly LineaParaCorregir[];
}

export async function escribirVentaCorregida(tx: Prisma.TransactionClient, venta: VentaCorregidaAEscribir): Promise<{ ventaNuevaId: string; movimientos: number }> {
  const { cabecera } = venta;
  const nueva = await tx.operacion.create({
    data: {
      sucursalId: venta.sucursalId,
      proceso: "VENTA",
      fecha: cabecera.fecha,
      clienteId: cabecera.clienteId,
      nroFactura: cabecera.nroFactura,
      seccionDestinoId: cabecera.seccionDestinoId,
      detalleLibre: cabecera.detalleLibre,
      usuarioId: cabecera.usuarioId,
      reemplazaAOperacionId: venta.ventaReemplazadaId,
    },
  });
  const filas: Prisma.MovimientoStockCreateManyInput[] = venta.lineas.map((l) => ({
    operacionId: nueva.id,
    productoId: l.productoId,
    seccionId: l.seccionId,
    proceso: l.proceso as Prisma.MovimientoStockCreateManyInput["proceso"],
    cantidad: l.cantidad,
    cantidadExacta: l.cantidadExacta,
    loteVencimiento: l.loteVencimiento,
    detalle: l.detalle,
    precioTotal: l.precioTotal,
    precioPorUnidadStock: l.precioPorUnidadStock,
    costoUnitarioVenta: l.costoUnitarioVenta,
    precioListaUnitario: l.precioListaUnitario,
    ...(l.sustituyeAProductoId ? { sustituyeAProductoId: l.sustituyeAProductoId } : {}),
  }));
  await tx.movimientoStock.createMany({ data: filas });
  return { ventaNuevaId: nueva.id, movimientos: filas.length };
}
