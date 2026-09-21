import type { Prisma } from "@prisma/client";

/**
 * Cómo se reconoce la Operación AJUSTE que escribe una anulación (`anularVenta`, `anularCompra`).
 *
 * Anular es un contra-asiento (Kardex append-only): se escribe una Operación AJUSTE nueva con una línea inversa por cada línea de la original, y la original
 * se marca `anuladaEn`. Esa AJUSTE es un mecanismo interno de la anulación, NO un ajuste manual de stock: si un reporte de «diferencias de ajuste» la contara,
 * mostraría como anomalía (o como una señal falsa para recalibrar una merma) algo que es el propio deshacer de una venta o de una compra.
 *
 * La reversión no guarda una referencia a la operación que revierte, así que se reconoce por el comienzo de su `detalleLibre`. Estos prefijos son la ÚNICA fuente:
 * las acciones arman el texto con ellos y los reportes lo reconocen con ellos. Una venta anulada antes de que existiera este módulo usa el mismo prefijo, así
 * que también queda cubierta.
 */
export const PREFIJO_REVERSION_VENTA = "Anulación de la venta ";
export const PREFIJO_REVERSION_COMPRA = "Anulación de la compra ";

/** `detalleLibre` de la Operación AJUSTE que revierte una venta. */
export function detalleReversionDeVenta(idVenta: string, fechaVenta: Date): string {
  return `${PREFIJO_REVERSION_VENTA}${idVenta} (${fechaVenta.toISOString().slice(0, 10)}).`;
}

/** `detalleLibre` de la Operación AJUSTE que revierte una compra; con el N.º de factura, si lo tiene. */
export function detalleReversionDeCompra(idCompra: string, fechaCompra: Date, nroFactura: string | null): string {
  return `${PREFIJO_REVERSION_COMPRA}${idCompra} (${fechaCompra.toISOString().slice(0, 10)}${nroFactura ? `, factura ${nroFactura}` : ""}).`;
}

/**
 * Filtro de `Operacion` que deja afuera las reversiones por anulación y conserva todo lo demás. Incluye `detalleLibre: null` a propósito: en SQL,
 * `NOT (detalleLibre LIKE ...)` es NULL cuando `detalleLibre` es NULL, y esas operaciones (la enorme mayoría) se perderían.
 */
export const OPERACION_QUE_NO_ES_REVERSION_POR_ANULACION: Prisma.OperacionWhereInput = {
  OR: [
    { detalleLibre: null },
    { AND: [{ NOT: { detalleLibre: { startsWith: PREFIJO_REVERSION_VENTA } } }, { NOT: { detalleLibre: { startsWith: PREFIJO_REVERSION_COMPRA } } }] },
  ],
};
