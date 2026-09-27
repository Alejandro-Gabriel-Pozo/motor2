/**
 * Reglas de la ANULACIÓN de una compra (K1c, docs/planes-implementacion-pendientes-2026-09-21.md §5). Módulo PURO: sin base de datos ni permisos.
 * Dado lo que se compró y los saldos actuales, decide si se puede anular y qué líneas inversas hay que escribir.
 *
 * Anular una compra es escribir su CONTRA-ASIENTO, no editarla: el Kardex es append-only (`schema.prisma`, MovimientoStock), así que la compra original
 * y sus líneas no se tocan. Se escribe una Operación AJUSTE nueva con una línea inversa por cada línea comprada (mismo producto, sección y lote,
 * cantidad y precio con el signo invertido) y la compra se marca `anuladaEn`. Mismo criterio que `anularVenta`; se usa AJUSTE y no un Proceso nuevo por
 * la misma razón (ya es «delta firmado» y está fuera de todo reporte que suma por magnitud).
 *
 * VALUACIÓN: la reversión lleva el precio de la propia compra (cada línea ya guarda su `precioTotal` y su `precioPorUnidadStock` reales), así que la
 * anulación se valúa sola al costo de la compra original. Es lo que hace ERPNext con `incoming_rate`, y no depende de ninguna decisión.
 *
 * STOCK CONSUMIDO: no se puede anular si lo comprado ya no está. Se compara, por cada (producto, sección, lote), lo que se compró contra el saldo actual
 * de ESE lote —no del total del producto: con el total, una compra cuyo lote ya se vendió pasaría si hay stock de otro lote y dejaría el lote en negativo—.
 * Con stock consumido la salida es otra (una Devolución a proveedor, y más adelante una nota de crédito), no anular.
 */

export interface LineaComprada {
  productoId: string;
  productoCodigo: string;
  productoNombre: string;
  seccionId: string;
  seccionNombre: string;
  loteVencimiento: Date | null;
  /** Tal como está guardada (una compra suma stock: positiva). */
  cantidad: number;
  precioTotal: number;
  precioPorUnidadStock: number;
  detalle: string;
}

/** Saldo actual por (producto, sección, lote), con la clave de `claveDeLote`. */
export type SaldosPorLote = ReadonlyMap<string, number>;

export interface CompraAAnular {
  proceso: string;
  anuladaEn: Date | null;
  lineas: readonly LineaComprada[];
}

export interface LineaFaltante {
  productoNombre: string;
  seccionNombre: string;
  loteVencimiento: Date | null;
  comprado: number;
  disponible: number;
}

export interface LineaDeReversion {
  productoId: string;
  seccionId: string;
  loteVencimiento: Date | null;
  cantidad: number;
  precioTotal: number;
  precioPorUnidadStock: number;
  detalle: string;
}

export type ResultadoAnulacion =
  | { ok: true; reversion: LineaDeReversion[] }
  | { ok: false; motivo: "NO_ES_COMPRA" | "YA_ANULADA" | "SIN_LINEAS" | "STOCK_CONSUMIDO"; mensaje: string; faltantes: LineaFaltante[] };

/** La clave de un bucket de stock: el mismo producto en la misma sección y con el mismo lote (o sin lote). */
export function claveDeLote(productoId: string, seccionId: string, loteVencimiento: Date | null): string {
  return `${productoId}|${seccionId}|${loteVencimiento ? loteVencimiento.toISOString() : ""}`;
}

/** Lo comprado, sumado por bucket: dos líneas de la misma factura con el mismo producto, sección y lote se comparan JUNTAS contra el saldo (nunca cada una aislada). */
function compradoPorBucket(lineas: readonly LineaComprada[]): Map<string, LineaFaltante & { clave: string }> {
  const porBucket = new Map<string, LineaFaltante & { clave: string }>();
  for (const l of lineas) {
    const clave = claveDeLote(l.productoId, l.seccionId, l.loteVencimiento);
    const previo = porBucket.get(clave);
    if (previo) previo.comprado += l.cantidad;
    else porBucket.set(clave, { clave, productoNombre: l.productoNombre, seccionNombre: l.seccionNombre, loteVencimiento: l.loteVencimiento, comprado: l.cantidad, disponible: 0 });
  }
  return porBucket;
}

const fechaCorta = (f: Date) => f.toISOString().slice(0, 10);

function describirFaltante(f: LineaFaltante): string {
  const lote = f.loteVencimiento ? `, lote que vence el ${fechaCorta(f.loteVencimiento)}` : "";
  return `${f.productoNombre} (${f.seccionNombre}${lote}): se compraron ${f.comprado} y hoy quedan ${f.disponible}`;
}

export function evaluarAnulacion(compra: CompraAAnular, saldos: SaldosPorLote): ResultadoAnulacion {
  if (compra.proceso !== "COMPRA") {
    return { ok: false, motivo: "NO_ES_COMPRA", mensaje: `Esa operación no es una Compra — es "${compra.proceso}".`, faltantes: [] };
  }
  if (compra.anuladaEn) return { ok: false, motivo: "YA_ANULADA", mensaje: "Esta compra ya está anulada.", faltantes: [] };
  if (!compra.lineas.length) return { ok: false, motivo: "SIN_LINEAS", mensaje: "Esta compra no tiene líneas que anular.", faltantes: [] };

  const faltantes: LineaFaltante[] = [];
  for (const b of compradoPorBucket(compra.lineas).values()) {
    const disponible = saldos.get(b.clave) ?? 0;
    // Tolerancia de milésimas: las cantidades de stock se redondean a 3 decimales (`redondearCantidad`); sin ella un saldo de 9,9999999999 por
    // aritmética de coma flotante bloquearía la anulación de una compra de 10.
    if (disponible + 0.0005 < b.comprado) faltantes.push({ productoNombre: b.productoNombre, seccionNombre: b.seccionNombre, loteVencimiento: b.loteVencimiento, comprado: b.comprado, disponible });
  }

  if (faltantes.length) {
    return {
      ok: false,
      motivo: "STOCK_CONSUMIDO",
      mensaje:
        `No se puede anular esta compra: parte de lo que se compró ya se consumió o se movió. ${faltantes.map(describirFaltante).join("; ")}. ` +
        `Si le devolviste mercadería al proveedor, registrala como Devolución a proveedor en vez de anular la compra.`,
      faltantes,
    };
  }

  return { ok: true, reversion: construirReversion(compra.lineas) };
}

/**
 * Mensaje de éxito de una anulación (Task #41, Fase M): texto EXACTO que armaba en línea la Server Action `anularCompra` antes de pasar
 * a su caso de uso. Es también el que se guarda como resultado I3 y se devuelve tal cual en un reenvío.
 */
export function mensajeCompraAnulada(movimientosRevertidos: number, nroFactura: string | null): string {
  return `Compra anulada. Se revirtieron ${movimientosRevertidos} movimiento(s) de stock${nroFactura ? ` y el N.º de factura ${nroFactura} quedó libre para volver a cargarla` : ""}.`;
}

/**
 * Descripción de la fila de auditoría de una anulación (campo `anuladaEn`), con el texto EXACTO de antes. `proveedorNombre` es `null` si
 * la compra no tiene proveedor (antes se miraba si existía la relación, no si el nombre estaba vacío: se mantiene).
 */
export function descripcionAuditoriaAnulacion(fecha: Date, proveedorNombre: string | null, nroFactura: string | null): string {
  return `Compra del ${fechaCorta(fecha)}${proveedorNombre !== null ? ` a ${proveedorNombre}` : ""}${nroFactura ? `, factura ${nroFactura}` : ""}: anulación`;
}

/** Una línea inversa por cada línea comprada: misma sección y lote, cantidad y precio total con el signo invertido, y el mismo precio por unidad (como `anularVenta`). */
export function construirReversion(lineas: readonly LineaComprada[]): LineaDeReversion[] {
  return lineas.map((l) => ({
    productoId: l.productoId,
    seccionId: l.seccionId,
    loteVencimiento: l.loteVencimiento,
    cantidad: -l.cantidad,
    precioTotal: -l.precioTotal,
    precioPorUnidadStock: l.precioPorUnidadStock,
    detalle: `Anulación de compra: revierte "${l.detalle}".`,
  }));
}
