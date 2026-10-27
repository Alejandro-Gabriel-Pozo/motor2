/**
 * «Parámetros por insumo» (Fase 7, DEC-27; diseño en `docs/diseno-modulo-stock-2026-10-27.md` §9): una fila por producto con lo que tiene configurado en la sucursal activa —mínimo global, mínimos por
 * depósito, depósito habitual y frecuencia de conteo—, armada en memoria con las MISMAS listas que muestran sus editores (`listarStockMinimo`, `listarSeccionesHabituales`, `listarFrecuenciasConteo`). No es
 * una tabla nueva ni escribe nada. Cada lista llega solo si el rol tiene el «Ver» de su clave: una lista ausente (`undefined`) es una columna que no se muestra, distinto de una lista vacía (columna que se
 * muestra sin nada cargado). Puro: sin Prisma ni permisos.
 */

interface ProductoDeLaFila {
  codigo: string;
  nombre: string;
}

/** Una fila de `StockMinimoProducto` como la lee `listarStockMinimo`: global si `seccionId` es null. */
export interface MinimoLeido {
  id: string;
  productoId: string;
  seccionId: string | null;
  /** El `Decimal` de la base ya pasado a número. */
  minimo: number;
  producto: ProductoDeLaFila;
  seccion: { nombre: string } | null;
}

export interface HabitualLeido {
  id: string;
  productoId: string;
  producto: ProductoDeLaFila;
  seccion: { nombre: string };
}

export interface FrecuenciaLeida {
  id: string;
  productoId: string;
  frecuenciaDias: number;
  producto: ProductoDeLaFila;
}

export interface ParametrosDeUnInsumo {
  productoId: string;
  productoCodigo: string;
  productoNombre: string;
  /** El mínimo de toda la sucursal; `null` = sin cargar. */
  minimoGlobal: { id: string; minimo: number } | null;
  /** Los mínimos de un depósito puntual, por nombre del depósito. */
  minimosPorDeposito: { id: string; deposito: string; minimo: number }[];
  depositoHabitual: { id: string; deposito: string } | null;
  /** `dias` 0 = la agenda está desactivada (la fila existe). */
  frecuencia: { id: string; dias: number } | null;
}

const porNombre = (a: string, b: string) => a.localeCompare(b, "es-AR");

export function armarParametrosPorInsumo(entrada: {
  minimos?: readonly MinimoLeido[];
  habituales?: readonly HabitualLeido[];
  frecuencias?: readonly FrecuenciaLeida[];
}): ParametrosDeUnInsumo[] {
  const filas = new Map<string, ParametrosDeUnInsumo>();
  const fila = (productoId: string, producto: ProductoDeLaFila): ParametrosDeUnInsumo => {
    let f = filas.get(productoId);
    if (!f) {
      f = { productoId, productoCodigo: producto.codigo, productoNombre: producto.nombre, minimoGlobal: null, minimosPorDeposito: [], depositoHabitual: null, frecuencia: null };
      filas.set(productoId, f);
    }
    return f;
  };
  for (const m of entrada.minimos ?? []) {
    const f = fila(m.productoId, m.producto);
    if (m.seccionId === null || m.seccion === null) f.minimoGlobal = { id: m.id, minimo: m.minimo };
    else f.minimosPorDeposito.push({ id: m.id, deposito: m.seccion.nombre, minimo: m.minimo });
  }
  for (const h of entrada.habituales ?? []) fila(h.productoId, h.producto).depositoHabitual = { id: h.id, deposito: h.seccion.nombre };
  for (const q of entrada.frecuencias ?? []) fila(q.productoId, q.producto).frecuencia = { id: q.id, dias: q.frecuenciaDias };
  for (const f of filas.values()) f.minimosPorDeposito.sort((a, b) => porNombre(a.deposito, b.deposito));
  return [...filas.values()].sort((a, b) => porNombre(a.productoNombre, b.productoNombre) || porNombre(a.productoCodigo, b.productoCodigo));
}

/**
 * La fila de mínimo que RIGE para un producto en un depósito (la que usa la alerta): la del depósito si existe, si no la global de la sucursal; `null` si no hay ninguna. Misma prioridad que `elegirMinimo`
 * (`stock-minimo.ts`), pero devuelve la FILA (su id y su valor), que es lo que necesita el atajo «Cambiar mínimo» para abrir el editor sobre ella.
 */
export function filaDeMinimoQueRige<F extends { productoId: string; seccionId: string | null }>(minimos: readonly F[], productoId: string, seccionId: string): F | null {
  return minimos.find((m) => m.productoId === productoId && m.seccionId === seccionId) ?? minimos.find((m) => m.productoId === productoId && m.seccionId === null) ?? null;
}
