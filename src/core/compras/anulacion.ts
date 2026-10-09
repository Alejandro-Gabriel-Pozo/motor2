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
 * Y TAMBIÉN el saldo TOTAL del (producto, sección) contra lo comprado de ese par (S-02): si parte del stock salió por un camino sin lote (un traspaso, una
 * merma), el bucket del lote sigue lleno pero el total no, y anular dejaría el producto en negativo. Hacen falta las DOS condiciones.
 * Con stock consumido la salida es otra (una Devolución a proveedor, y más adelante una nota de crédito), no anular.
 */
import type { MotivoAnulacionRechazada } from "@/core/features/compras/compra.schema";
import { GUIA_PARA_CORREGIR_CON_UN_AJUSTE } from "@/core/guia-de-ajuste";

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
  /** S-02: `true` si lo que falta es el saldo TOTAL del (producto, sección) y no el de un lote (`loteVencimiento` va en `null`). Ausente en el faltante de un bucket. */
  enTotal?: true;
  /** M-7: el saldo (negativo) del bucket SIN lote del (producto, sección), cuando es lo que hace que el total no alcance. Solo acompaña a `enTotal`. */
  saldoNegativoSinLote?: number;
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
  | { ok: false; motivo: MotivoAnulacionRechazada; mensaje: string; faltantes: LineaFaltante[] };

/** La clave de un bucket de stock: el mismo producto en la misma sección y con el mismo lote (o sin lote). */
export function claveDeLote(productoId: string, seccionId: string, loteVencimiento: Date | null): string {
  return `${productoId}|${seccionId}|${loteVencimiento ? loteVencimiento.toISOString() : ""}`;
}

/** La clave de un par (producto, sección): el prefijo común de todos sus buckets (`claveDeLote`). Los ids son cuid: no contienen `|`. */
function claveDePar(productoId: string, seccionId: string): string {
  return `${productoId}|${seccionId}|`;
}

/**
 * El saldo TOTAL de un (producto, sección): la suma de TODOS sus buckets (con lote y sin lote) de `saldos`. Quien arma `saldos` tiene que traer todos los
 * buckets de los pares que toca la compra, no solo los de sus lotes (`cargarCompraParaAnular` lo hace: su `groupBy` por (producto, sección, lote) no filtra por lote).
 */
function saldoTotalDelPar(saldos: SaldosPorLote, productoId: string, seccionId: string): number {
  const prefijo = claveDePar(productoId, seccionId);
  let total = 0;
  for (const [clave, saldo] of saldos) if (clave.startsWith(prefijo)) total += saldo;
  return total;
}

/** Lo comprado, sumado por bucket: dos líneas de la misma factura con el mismo producto, sección y lote se comparan JUNTAS contra el saldo (nunca cada una aislada). */
function compradoPorBucket(lineas: readonly LineaComprada[]): Map<string, LineaFaltante & { clave: string; par: string }> {
  const porBucket = new Map<string, LineaFaltante & { clave: string; par: string }>();
  for (const l of lineas) {
    const clave = claveDeLote(l.productoId, l.seccionId, l.loteVencimiento);
    const previo = porBucket.get(clave);
    if (previo) previo.comprado += l.cantidad;
    else porBucket.set(clave, { clave, par: claveDePar(l.productoId, l.seccionId), productoNombre: l.productoNombre, seccionNombre: l.seccionNombre, loteVencimiento: l.loteVencimiento, comprado: l.cantidad, disponible: 0 });
  }
  return porBucket;
}

/** Lo comprado, sumado por (producto, sección) sin mirar el lote: contra el saldo TOTAL del par (S-02). */
function compradoPorPar(lineas: readonly LineaComprada[]): Map<string, { par: string; productoId: string; seccionId: string; productoNombre: string; seccionNombre: string; comprado: number }> {
  const porPar = new Map<string, { par: string; productoId: string; seccionId: string; productoNombre: string; seccionNombre: string; comprado: number }>();
  for (const l of lineas) {
    const par = claveDePar(l.productoId, l.seccionId);
    const previo = porPar.get(par);
    if (previo) previo.comprado += l.cantidad;
    else porPar.set(par, { par, productoId: l.productoId, seccionId: l.seccionId, productoNombre: l.productoNombre, seccionNombre: l.seccionNombre, comprado: l.cantidad });
  }
  return porPar;
}

const fechaCorta = (f: Date) => f.toISOString().slice(0, 10);

function describirFaltante(f: LineaFaltante): string {
  const lote = f.loteVencimiento ? `, lote que vence el ${fechaCorta(f.loteVencimiento)}` : "";
  const total = f.enTotal ? " en total, entre todos los lotes de la sección (parte salió sin lote, por ejemplo en un traspaso)" : "";
  const base = `${f.productoNombre} (${f.seccionNombre}${lote}): se compraron ${f.comprado} y hoy quedan ${f.disponible}${total}`;
  return f.saldoNegativoSinLote === undefined ? base : `${base}. ${guiaParaSaldoNegativoSinLote(f)}`;
}

/**
 * M-7 (decidido por el dueño): la guía para destrabar la anulación cuando el total no alcanza porque el bucket SIN lote está en negativo (el POS vende en negativo por diseño y después entró esta
 * compra con lote). Hay dos causas y la guía dice las dos, porque el saldo no distingue cuál fue: (a) un descuadre del registro (se vendió antes de cargar la compra): lo resuelve un AJUSTE de stock
 * (`proceso_ajuste`, piso administrador, igual que anular la compra) que sume lo que falta, sin lote; el total pasa a cubrir lo comprado y la anulación sigue. NO un conteo físico: uno posterior a la
 * compra la frena (M-3), y un ajuste manual no (`soloConteos`). Si no tiene el permiso de Ajuste, que se lo pida a quien lo tenga. (b) La mercadería de verdad salió (un traspaso): ajustar inventaría
 * stock que no existe; la salida es una Devolución a proveedor.
 */
function guiaParaSaldoNegativoSinLote(f: LineaFaltante): string {
  const falta = -(f.saldoNegativoSinLote ?? 0);
  return (
    `Hay un saldo negativo sin lote de ${f.saldoNegativoSinLote} (salió sin lote más de lo que había). ` +
    `Si esa mercadería se vendió antes de cargar la compra, o es un descuadre del registro, llevalo a cero con un Ajuste de stock de +${falta} de ${f.productoNombre} en ${f.seccionNombre}, sin lote ` +
    `(o pedíselo a quien pueda registrar ajustes), y volvé a anular la compra; no uses un conteo físico para esto, porque un conteo posterior a la compra impide anularla. ` +
    `Si la mercadería de verdad salió (por ejemplo, se traspasó), la compra no se puede anular: registrá esa salida como Devolución a proveedor`
  );
}

export function evaluarAnulacion(compra: CompraAAnular, saldos: SaldosPorLote): ResultadoAnulacion {
  if (compra.proceso !== "COMPRA") {
    return { ok: false, motivo: "NO_ES_COMPRA", mensaje: `Esa operación no es una Compra — es "${compra.proceso}".`, faltantes: [] };
  }
  if (compra.anuladaEn) return { ok: false, motivo: "YA_ANULADA", mensaje: "Esta compra ya está anulada.", faltantes: [] };
  if (!compra.lineas.length) return { ok: false, motivo: "SIN_LINEAS", mensaje: "Esta compra no tiene líneas que anular.", faltantes: [] };

  const faltantes: LineaFaltante[] = [];
  // Tolerancia de milésimas: las cantidades de stock se redondean a 3 decimales (`redondearCantidad`); sin ella un saldo de 9,9999999999 por
  // aritmética de coma flotante bloquearía la anulación de una compra de 10.
  const TOLERANCIA = 0.0005;
  const paresConFaltante = new Set<string>();
  for (const b of compradoPorBucket(compra.lineas).values()) {
    const disponible = saldos.get(b.clave) ?? 0;
    if (disponible + TOLERANCIA < b.comprado) {
      faltantes.push({ productoNombre: b.productoNombre, seccionNombre: b.seccionNombre, loteVencimiento: b.loteVencimiento, comprado: b.comprado, disponible });
      paresConFaltante.add(b.par);
    }
  }
  // S-02 (O.51): además del bucket, el saldo TOTAL de cada (producto, sección) tiene que cubrir lo comprado de ese par. Si parte del stock salió por un camino SIN
  // lote (un traspaso, una merma), el bucket del lote sigue "lleno" y el total no: anular dejaba el producto en negativo en el Kardex.
  for (const p of compradoPorPar(compra.lineas).values()) {
    if (paresConFaltante.has(p.par)) continue; // ya informado por su bucket
    const disponible = saldoTotalDelPar(saldos, p.productoId, p.seccionId);
    if (disponible + TOLERANCIA < p.comprado) {
      // M-7: el POS vende en negativo por diseño. Si el bucket SIN lote del par está en negativo (se vendió más de lo que había) y DESPUÉS entró esta compra con lote, el total no alcanza aunque el lote
      // esté entero: lo que falta es llevar ese saldo a cero, y el mensaje dice cómo.
      const sinLote = saldos.get(p.par) ?? 0;
      faltantes.push({
        productoNombre: p.productoNombre, seccionNombre: p.seccionNombre, loteVencimiento: null, comprado: p.comprado, disponible, enTotal: true,
        ...(sinLote < -TOLERANCIA ? { saldoNegativoSinLote: sinLote } : {}),
      });
    }
  }

  if (faltantes.length) {
    return {
      ok: false,
      motivo: "STOCK_CONSUMIDO",
      mensaje: (
        `No se puede anular esta compra: parte de lo que se compró ya se consumió o se movió. ${faltantes.map(describirFaltante).join("; ")}. ` +
        // La devolución al proveedor es la salida de lo que de verdad se consumió o se movió; si TODO lo que falta es un saldo negativo sin lote, la salida es el ajuste que ya dice la guía (M-7).
        (faltantes.every((f) => f.saldoNegativoSinLote !== undefined) ? "" : `Si le devolviste mercadería al proveedor, registrala como Devolución a proveedor en vez de anular la compra.`)
      ).trimEnd(),
      faltantes,
    };
  }

  return { ok: true, reversion: construirReversion(compra.lineas) };
}

/**
 * D7 (M-3 de la auditoría final; la misma regla que anular una VENTA, `evaluarPosterioresAAnularVenta` de `core/movimientos`, pero SOLO con conteos: un ajuste manual no cuenta, es el remedio que
 * dice el mensaje y el que indica `STOCK_CONSUMIDO` para destrabar una compra, M-7): una compra NO se anula si después hubo un conteo físico (con o sin movimiento) del mismo producto en la misma
 * sección de alguna de sus líneas. El stock ya se reconcilió contra lo contado y la reversión restaría de nuevo lo que el conteo ya absorbió:
 * el saldo queda mal aunque «alcance» para anular (`evaluarAnulacion`). El historial no se reescribe: se corrige con un ajuste. Fallo cerrado, sin pedir confirmación.
 * `posteriores` lo arma `cargarReconciliacionesPosteriores` (server/persistencia/movimientos), ya sin repetidos y con los nombres para el mensaje.
 */
export function evaluarPosterioresAAnularCompra(posteriores: readonly { productoNombre: string; seccionNombre: string }[]): { ok: true } | { ok: false; motivo: "CONTEO_POSTERIOR"; mensaje: string } {
  if (!posteriores.length) return { ok: true };
  const donde = posteriores.map((c) => `${c.productoNombre} (${c.seccionNombre})`).join(", ");
  return {
    ok: false,
    motivo: "CONTEO_POSTERIOR",
    mensaje: `No se puede anular esta compra: después de hacerse hubo un conteo físico de ${donde}, y anularla ahora desharía a ciegas un stock que ya se reconcilió. ${GUIA_PARA_CORREGIR_CON_UN_AJUSTE}`,
  };
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
