import "server-only";
import type { Prisma } from "@prisma/client";

/**
 * Escrituras del CIERRE de una cuenta del salón (Task #41, Fase M12a — docs/arquitectura-casos-de-uso-2026-09-27.md; mismo contrato que
 * `server/persistencia/movimientos/escribir-anulacion-de-venta.ts`: `tx` OBLIGATORIO, sin reglas de negocio). Son EXACTAMENTE las
 * escrituras que antes hacía en línea `cerrarCuenta` (src/server/actions/pos/cuenta-cierre.ts); el ORDEN lo pone el caso de uso
 * (src/server/actions/pos/casos-de-uso/cerrar-cuenta.ts): venta (`registrarVentaEnTx`, núcleo de core/movimientos) → ejemplar A de la
 * ticket → enlace de cada ítem con su Operacion → cierre de la cuenta → auditoría de stock negativo.
 */

/**
 * El ejemplar A (`ejemplar: 1`) del ticket, con el número ya calculado por el caso de uso. Dos cierres simultáneos de la misma
 * sucursal chocan en el índice único (+ SERIALIZABLE) y uno reintenta: sin huecos ni repetidos.
 */
export async function escribirEjemplarOriginalDeTicket(
  tx: Prisma.TransactionClient,
  args: { sucursalId: string; cuentaId: string; numero: number; emitidoEn: Date; emitidoPorId: string }
): Promise<void> {
  await tx.ejemplarTicket.create({
    data: { sucursalId: args.sucursalId, cuentaId: args.cuentaId, numero: args.numero, ejemplar: 1, emitidoEn: args.emitidoEn, emitidoPorId: args.emitidoPorId },
  });
}

/** Una línea neta de la venta con la Operacion VENTA que le tocó: la clave es (producto, precio de LISTA, promo). */
export interface EnlaceDeLineaAOperacion {
  productoId: string;
  precioUnitario: number;
  promoCuentaId?: string | null;
  /** Solo de un suelto con descuento de producto (parte de su clave, ver `claveDeLineaDeVenta`): el precio de lista del ítem. */
  precioCartaUnitario?: number | null;
  operacionId: string;
}

/**
 * Enlaza cada ítem de la cuenta (originales y espejos) con la Operacion VENTA de su línea (`CuentaItem.operacionId`), una línea por vez
 * y en el orden recibido. `promoCuentaId ?? null` explícito (Task #16): un `undefined` en el `where` de Prisma OMITE el filtro entero,
 * no filtra por null — con eso, un suelto mezclaría con un componente de promo del mismo producto y precio (D4).
 */
export async function enlazarItemsConOperaciones(tx: Prisma.TransactionClient, cuentaId: string, enlaces: readonly EnlaceDeLineaAOperacion[]): Promise<void> {
  for (const e of enlaces) {
    await tx.cuentaItem.updateMany({
      where: {
        cuentaId,
        productoId: e.productoId,
        precioUnitario: e.precioUnitario,
        promoCuentaId: e.promoCuentaId ?? null,
        ...(e.promoCuentaId ? {} : { precioCartaUnitario: e.precioCartaUnitario ?? null }),
      },
      data: { operacionId: e.operacionId },
    });
  }
}

/** Cierra la cuenta (`cerradaEn`/`cerradaPorId`): la mesa queda libre. */
export async function marcarCuentaCerrada(tx: Prisma.TransactionClient, args: { cuentaId: string; cerradaEn: Date; cerradaPorId: string }): Promise<void> {
  await tx.cuenta.update({ where: { id: args.cuentaId }, data: { cerradaEn: args.cerradaEn, cerradaPorId: args.cerradaPorId } });
}
