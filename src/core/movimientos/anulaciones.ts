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
const PREFIJO_REVERSION_VENTA = "Anulación de la venta ";
const PREFIJO_REVERSION_COMPRA = "Anulación de la compra ";

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

/**
 * Reglas de la ANULACIÓN de una venta (Task #41, Fase M — docs/arquitectura-casos-de-uso-2026-09-27.md). Puras: son las guardas, el
 * contra-asiento y los textos que antes vivían en línea en la Server Action `anularVenta` (src/server/actions/movimientos/venta.ts),
 * con los MISMOS textos; la orquestación está en `casos-de-uso/anular-venta.ts`.
 */
export interface VentaAAnular {
  proceso: string;
  anuladaEn: Date | null;
}

export type ResultadoAnulacionDeVenta = { ok: true } | { ok: false; motivo: "NO_ES_VENTA" | "YA_ANULADA"; mensaje: string };

/**
 * Si la operación se puede anular como venta: tiene que ser una VENTA y no estar anulada (en ese orden). `operacionId` es el que se
 * pidió anular: el mensaje de «no es una Venta» lo nombra, como antes.
 */
export function evaluarAnulacionDeVenta(operacionId: string, venta: VentaAAnular): ResultadoAnulacionDeVenta {
  if (venta.proceso !== "VENTA") return { ok: false, motivo: "NO_ES_VENTA", mensaje: `La operación "${operacionId}" no es una Venta — es "${venta.proceso}".` };
  if (venta.anuladaEn) return { ok: false, motivo: "YA_ANULADA", mensaje: "Esta venta ya está anulada." };
  return { ok: true };
}

/** Una línea de Kardex de la venta, tal como se guardó (los `Decimal` ya convertidos a `number` por la persistencia). */
export interface LineaVendida {
  productoId: string;
  seccionId: string;
  proceso: string;
  cantidad: number;
  /** Arrastre de redondeo (Task #27): `null` si la línea no lo guarda. */
  cantidadExacta: number | null;
  loteVencimiento: Date | null;
  detalle: string;
  precioTotal: number;
  precioPorUnidadStock: number;
}

export interface LineaDeReversionDeVenta {
  productoId: string;
  seccionId: string;
  proceso: "AJUSTE" | "LIQUIDACION_CONSIGNACION";
  cantidad: number;
  cantidadExacta: number | null;
  loteVencimiento: Date | null;
  detalle: string;
  precioTotal: number;
  precioPorUnidadStock: number;
}

/**
 * Una línea inversa por cada línea vendida: mismo producto, sección y lote; cantidad, `cantidadExacta` y precio total con el signo
 * invertido; el mismo precio por unidad. Todas son AJUSTE, salvo la LIQUIDACION_CONSIGNACION (si la venta consumió una MP en
 * consignación), que se revierte con su mismo Proceso —cantidad en 0 igual que la original, precio en negativo— para que el reporte de
 * Consignación (que suma esas líneas tal cual) quede neto solo.
 *
 * `cantidadExacta` (Arrastre de redondeo, Task #27, docs/plan-redondeo-consumo-fraccionado-2026-09-26.md): invertida igual que
 * `cantidad`, para que la deuda de redondeo del producto (`D = Σcantidad − ΣcantidadExacta`) vuelva EXACTAMENTE al estado que corresponde
 * a las ventas que siguen vigentes.
 */
export function construirReversionDeVenta(lineas: readonly LineaVendida[]): LineaDeReversionDeVenta[] {
  return lineas.map((l) => ({
    productoId: l.productoId,
    seccionId: l.seccionId,
    proceso: l.proceso === "LIQUIDACION_CONSIGNACION" ? "LIQUIDACION_CONSIGNACION" : "AJUSTE",
    cantidad: -l.cantidad,
    cantidadExacta: l.cantidadExacta === null ? null : -l.cantidadExacta,
    loteVencimiento: l.loteVencimiento,
    detalle: `Anulación de venta: revierte "${l.detalle}".`,
    precioTotal: -l.precioTotal,
    precioPorUnidadStock: l.precioPorUnidadStock,
  }));
}

/**
 * Mensaje de éxito de una anulación de venta, con el texto EXACTO que armaba `anularVenta`. `componentesDePromo` es la cantidad de
 * Operaciones anuladas juntas cuando la venta era parte de una promo con hermanas vigentes, `null` si fue una sola.
 */
export function mensajeVentaAnulada(movimientosRevertidos: number, huboLiquidacionConsignacion: boolean, componentesDePromo: number | null): string {
  const mensajePromo = componentesDePromo !== null ? ` Era una promo con ${componentesDePromo} componentes: se anularon todos juntos.` : "";
  return `Venta anulada. Se revirtieron ${movimientosRevertidos} movimiento(s) de stock${huboLiquidacionConsignacion ? " y la liquidación de consignación" : ""}.${mensajePromo}`;
}

/** Descripción de la fila de auditoría (campo `anuladaEn`) de CADA Operación anulada, con el texto EXACTO de antes. */
export function descripcionAuditoriaAnulacionDeVenta(fecha: Date, nroFactura: string | null, conHermanasDePromo: boolean): string {
  return `Venta del ${fecha.toISOString().slice(0, 10)}${nroFactura ? ` (factura ${nroFactura})` : ""}: anulación${conHermanasDePromo ? " (promo, junto con sus otros componentes)" : ""}`;
}
