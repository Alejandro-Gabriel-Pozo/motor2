import "server-only";
import type { Prisma } from "@prisma/client";
import type { ItemConVenta } from "@/core/pos/boleta";

/**
 * Lectura de la BOLETA CORREGIDA de una cuenta del salón (Task #41, Fase M12b — docs/arquitectura-casos-de-uso-2026-09-27.md; mismo
 * contrato que `cargar-cuenta-para-cerrar.ts`: `tx` OBLIGATORIO, tipos de dominio con los `Decimal` ya convertidos a `number`, sin reglas
 * de negocio). Es EXACTAMENTE la lectura que antes hacía en línea `emitirBoletaCorregida` (src/server/actions/pos/cuenta-cierre.ts), con
 * el mismo filtro por sucursal y el mismo orden de ejemplares.
 */

/** Un ejemplar ya emitido de la boleta de la cuenta (A = 1, B = 2…). */
export interface EjemplarDeBoletaEmitido {
  id: string;
  sucursalId: string;
  numero: number;
  ejemplar: number;
  emitidoEn: Date;
}

export interface CuentaParaCorregirBoleta {
  id: string;
  mesaNumero: number;
  cerradaEn: Date | null;
  /** Los ítems con la anulación de su Operacion VENTA (`anuladaEn`), en la forma de `estadoDeBoleta`/`armarBoletaVigente` (core/pos/boleta.ts). */
  items: ItemConVenta[];
  /** Los ejemplares de la boleta, del ÚLTIMO al primero (`ejemplar` descendente); vacío si se cerró antes de la numeración. */
  ejemplares: EjemplarDeBoletaEmitido[];
}

/** `null` si no hay ninguna cuenta con ese id en una mesa de esta sucursal (la sesión manda: nunca se carga la de otra sucursal). */
export async function cargarCuentaParaCorregirBoleta(
  tx: Prisma.TransactionClient,
  args: { cuentaId: string; sucursalId: string }
): Promise<CuentaParaCorregirBoleta | null> {
  const cuenta = await tx.cuenta.findFirst({
    where: { id: args.cuentaId, mesa: { sucursalId: args.sucursalId } },
    include: {
      mesa: { select: { numero: true } },
      items: { include: { producto: { select: { nombre: true } }, operacion: { select: { anuladaEn: true } } } },
      ejemplaresBoleta: { orderBy: { ejemplar: "desc" } },
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
      operacionId: i.operacionId,
      anuladaEn: i.operacion?.anuladaEn ?? null,
    })),
    ejemplares: cuenta.ejemplaresBoleta.map((e) => ({ id: e.id, sucursalId: e.sucursalId, numero: e.numero, ejemplar: e.ejemplar, emitidoEn: e.emitidoEn })),
  };
}
