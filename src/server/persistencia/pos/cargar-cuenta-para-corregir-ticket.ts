import "server-only";
import type { Prisma } from "@prisma/client";
import type { ItemConVenta } from "@/core/pos/ticket";

/**
 * Lectura de el TICKET CORREGIDO de una cuenta del salón (Task #41, Fase M12b — docs/arquitectura-casos-de-uso-2026-09-27.md; mismo
 * contrato que `cargar-cuenta-para-cerrar.ts`: `tx` OBLIGATORIO, tipos de dominio con los `Decimal` ya convertidos a `number`, sin reglas
 * de negocio). Es EXACTAMENTE la lectura que antes hacía en línea `emitirTicketCorregido` (src/server/actions/pos/cuenta-cierre.ts), con
 * el mismo filtro por sucursal y el mismo orden de ejemplares.
 */

/** Un ejemplar ya emitido del ticket de la cuenta (A = 1, B = 2…). */
export interface EjemplarDeTicketEmitido {
  id: string;
  sucursalId: string;
  numero: number;
  ejemplar: number;
  emitidoEn: Date;
}

export interface CuentaParaCorregirTicket {
  id: string;
  mesaNumero: number;
  cerradaEn: Date | null;
  /** Los ítems con la anulación de su Operacion VENTA (`anuladaEn`), en la forma de `estadoDeTicket`/`armarTicketVigente` (core/pos/ticket.ts). */
  items: ItemConVenta[];
  /** Los ejemplares del ticket, del ÚLTIMO al primero (`ejemplar` descendente); vacío si se cerró antes de la numeración. */
  ejemplares: EjemplarDeTicketEmitido[];
}

/** `null` si no hay ninguna cuenta con ese id en una mesa de esta sucursal (la sesión manda: nunca se carga la de otra sucursal). */
export async function cargarCuentaParaCorregirTicket(
  tx: Prisma.TransactionClient,
  args: { cuentaId: string; sucursalId: string }
): Promise<CuentaParaCorregirTicket | null> {
  const cuenta = await tx.cuenta.findFirst({
    where: { id: args.cuentaId, mesa: { sucursalId: args.sucursalId } },
    include: {
      mesa: { select: { numero: true } },
      items: { include: { producto: { select: { nombre: true } }, operacion: { select: { anuladaEn: true } } } },
      ejemplaresTicket: { orderBy: { ejemplar: "desc" } },
    },
  });
  if (!cuenta) return null;
  return {
    id: cuenta.id,
    mesaNumero: cuenta.mesa.numero,
    cerradaEn: cuenta.cerradaEn,
    items: cuenta.items.map((i) => ({
      productoId: i.productoId,
      productoNombre: i.producto.nombre,
      cantidad: Number(i.cantidad),
      precioUnitario: Number(i.precioUnitario),
      precioCartaUnitario: i.precioCartaUnitario !== null ? Number(i.precioCartaUnitario) : null,
      operacionId: i.operacionId,
      anuladaEn: i.operacion?.anuladaEn ?? null,
    })),
    ejemplares: cuenta.ejemplaresTicket.map((e) => ({ id: e.id, sucursalId: e.sucursalId, numero: e.numero, ejemplar: e.ejemplar, emitidoEn: e.emitidoEn })),
  };
}
