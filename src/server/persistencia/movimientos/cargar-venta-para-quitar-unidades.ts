import "server-only";
import type { Prisma } from "@prisma/client";
import type { LineaParaCorregir } from "@/core/movimientos/public";

/**
 * Carga de una venta para QUITARLE UNIDADES (E1 de la corrección por ajuste, docs/diseno-correccion-por-ajuste-2026-11-06.md). Mismo contrato que
 * `cargar-venta-para-anular.ts`: `tx` OBLIGATORIO, tipos de dominio con los `Decimal` ya convertidos a `number`, sin reglas de negocio.
 *
 * Trae lo que la anulación no necesita y la copia sí: por cada fila de la venta, lo CONGELADO (`costoUnitarioVenta`, `precioListaUnitario`, el sustituto de un
 * consumo), la cabecera que B repite (fecha, cliente, detalle…), si otra venta ya la reemplaza y los decimales de la unidad de stock de cada producto (hasta donde se
 * reparten las cantidades). Las filas salen en el orden en que se escribieron (`creadoEn` y, a igualdad, id), el mismo que usa `cargarVentaParaAnular`.
 */
export interface VentaParaQuitarUnidades {
  id: string;
  proceso: string;
  anuladaEn: Date | null;
  /** Otra venta ya la reemplaza (`Operacion.reemplazaAOperacionId`): la base solo deja una. */
  yaReemplazada: boolean;
  /** Cabecera que la venta nueva repite tal cual. */
  cabecera: {
    fecha: Date;
    clienteId: string | null;
    nroFactura: string | null;
    seccionDestinoId: string | null;
    detalleLibre: string | null;
    usuarioId: string;
  };
  lineas: LineaParaCorregir[];
  /** Decimales de la unidad de stock por producto. */
  decimalesPorProducto: ReadonlyMap<string, number>;
}

export async function cargarVentaParaQuitarUnidades(
  tx: Prisma.TransactionClient,
  args: { operacionId: string; sucursalId: string }
): Promise<VentaParaQuitarUnidades | null> {
  const operacion = await tx.operacion.findFirst({
    where: { id: args.operacionId, sucursalId: args.sucursalId },
    include: {
      movimientos: { orderBy: [{ creadoEn: "asc" }, { id: "asc" }], include: { producto: { select: { unidadStock: { select: { decimales: true } } } } } },
      reemplazadaPor: { select: { id: true } },
    },
  });
  if (!operacion) return null;
  return {
    id: operacion.id,
    proceso: operacion.proceso,
    anuladaEn: operacion.anuladaEn,
    yaReemplazada: operacion.reemplazadaPor !== null,
    cabecera: {
      fecha: operacion.fecha,
      clienteId: operacion.clienteId,
      nroFactura: operacion.nroFactura,
      seccionDestinoId: operacion.seccionDestinoId,
      detalleLibre: operacion.detalleLibre,
      usuarioId: operacion.usuarioId,
    },
    lineas: operacion.movimientos.map((m) => ({
      productoId: m.productoId,
      seccionId: m.seccionId,
      proceso: m.proceso,
      cantidad: Number(m.cantidad),
      cantidadExacta: m.cantidadExacta === null ? null : Number(m.cantidadExacta),
      loteVencimiento: m.loteVencimiento,
      detalle: m.detalle,
      precioTotal: Number(m.precioTotal),
      precioPorUnidadStock: Number(m.precioPorUnidadStock),
      costoUnitarioVenta: m.costoUnitarioVenta === null ? null : Number(m.costoUnitarioVenta),
      precioListaUnitario: m.precioListaUnitario === null ? null : Number(m.precioListaUnitario),
      sustituyeAProductoId: m.sustituyeAProductoId,
    })),
    decimalesPorProducto: new Map(operacion.movimientos.map((m) => [m.productoId, m.producto.unidadStock.decimales] as const)),
  };
}
