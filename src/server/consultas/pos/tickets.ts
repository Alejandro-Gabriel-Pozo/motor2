import "server-only";
import { TICKETS_RECIENTES_POR_MESA, armarTicketsDeCuentas, type TicketDeCuenta } from "@/core/pos/public";
import type { Db } from "@/lib/db-tipos";

/**
 * Las últimas cuentas cerradas CON VENTA de la mesa (al menos un ítem con `operacionId`: quedan afuera las liberadas sin ítems y las cerradas sin venta), de la más
 * nueva a la más vieja — una sola consulta. Aislada por sucursal: una mesa de otra sucursal no da nada. La lectura vive acá; el armado de los tickets es puro y vive
 * en `core/pos/ticket.ts` (Pureza Fase 3). Sin guarda de permiso adentro: la pantalla la pone antes.
 */
export async function obtenerTicketsRecientes(
  sucursalId: string,
  mesaId: string,
  db: Db,
  limite: number = TICKETS_RECIENTES_POR_MESA,
  ahora: Date = new Date(),
): Promise<TicketDeCuenta[]> {
  const cuentas = await db.cuenta.findMany({
    where: { mesaId, mesa: { sucursalId }, cerradaEn: { not: null }, items: { some: { operacionId: { not: null } } } },
    orderBy: [{ cerradaEn: "desc" }, { id: "desc" }],
    take: limite,
    include: {
      abiertaPor: { select: { name: true, email: true } },
      cliente: { select: { nombre: true } },
      items: {
        orderBy: [{ creadoEn: "asc" }, { id: "asc" }],
        include: { producto: { select: { nombre: true } }, operacion: { select: { anuladaEn: true } }, promoCuenta: { select: { id: true, titulo: true } } },
      },
      ejemplaresTicket: {
        orderBy: { ejemplar: "desc" },
        take: 1,
        select: { numero: true, ejemplar: true, emitidoEn: true, corrigeA: { select: { numero: true, ejemplar: true } } },
      },
    },
  });

  return armarTicketsDeCuentas(
    cuentas.map((c) => ({
      id: c.id,
      cerradaEn: c.cerradaEn,
      descuentoPorcentaje: c.descuentoPorcentaje !== null ? Number(c.descuentoPorcentaje) : null,
      abiertaPor: c.abiertaPor,
      cliente: c.cliente,
      items: c.items.map((i) => ({
        productoId: i.productoId,
        producto: i.producto,
        cantidad: Number(i.cantidad),
        precioUnitario: Number(i.precioUnitario),
        precioCartaUnitario: i.precioCartaUnitario !== null ? Number(i.precioCartaUnitario) : null,
        operacionId: i.operacionId,
        operacion: i.operacion,
        promoCuenta: i.promoCuenta,
      })),
      ejemplaresTicket: c.ejemplaresTicket,
    })),
    ahora,
  );
}
