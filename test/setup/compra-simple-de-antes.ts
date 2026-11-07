import { prisma } from "./test-db";

/**
 * Una «compra simple de antes de U0»: una `Operacion` COMPRA suelta con sus líneas de Kardex, SIN factura (ni cabecera, ni renglón, ni parte), con el número como texto, la unidad comprada en la línea y la clave de
 * reintento en la `Operacion`. Es la forma que `registrarMovimiento` COMPRA dejaba hasta U0 de «una sola compra» (docs/diseno-una-sola-compra-2026-11-06.md) y la que siguen teniendo las bases de demostración sembradas
 * antes (supuesto S4). Desde U0 NADIE en `src/` la escribe, así que los tests de lo que se hace con una compra así (anularla, corregirla mientras U1 no la retira, leerla en los reportes) la siembran directo.
 */
export interface ItemDeCompraSimpleDeAntes {
  productoId: string;
  cantidad: number;
  precioTotal: number;
  loteVencimiento?: Date | null;
  detalle?: string;
  /** La unidad en que se compró y cuántas (juntas o ninguna). */
  unidadCompraId?: string | null;
  cantidadCompra?: number | null;
}

export interface CompraSimpleDeAntes {
  sucursalId: string;
  seccionId: string;
  usuarioId: string;
  proveedorId: string;
  nroFactura: string;
  fecha?: Date;
  detalleLibre?: string | null;
  claveIdempotencia?: string | null;
  items: ItemDeCompraSimpleDeAntes[];
}

export async function sembrarCompraSimpleDeAntes(c: CompraSimpleDeAntes): Promise<{ operacionId: string }> {
  const operacion = await prisma.operacion.create({
    data: {
      sucursalId: c.sucursalId,
      proceso: "COMPRA",
      fecha: c.fecha ?? new Date(),
      usuarioId: c.usuarioId,
      proveedorId: c.proveedorId,
      nroFactura: c.nroFactura,
      detalleLibre: c.detalleLibre ?? null,
      claveIdempotencia: c.claveIdempotencia ?? null,
      payloadHash: c.claveIdempotencia ? `huella-${c.claveIdempotencia}` : null,
      resultadoMensaje: c.claveIdempotencia ? `Se guardaron ${c.items.length} movimiento(s).` : null,
    },
  });
  for (const item of c.items) {
    await prisma.movimientoStock.create({
      data: {
        operacionId: operacion.id,
        productoId: item.productoId,
        seccionId: c.seccionId,
        proceso: "COMPRA",
        cantidad: item.cantidad,
        loteVencimiento: item.loteVencimiento ?? null,
        detalle: item.detalle ?? "COMPRA",
        precioTotal: item.precioTotal,
        precioPorUnidadStock: item.cantidad > 0 && item.precioTotal > 0 ? Math.round((item.precioTotal / item.cantidad) * 10000) / 10000 : 0,
        unidadCompraId: item.unidadCompraId ?? null,
        cantidadCompra: item.cantidadCompra ?? null,
      },
    });
  }
  return { operacionId: operacion.id };
}
