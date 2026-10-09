import { elegirMinimo } from "./stock-minimo";

export type EstadoAlerta = "CRITICO" | "BAJO";

export interface FilaAlertaStock {
  productoId: string;
  productoCodigo: string;
  productoNombre: string;
  seccionId: string;
  seccionNombre: string;
  saldoActual: number;
  stockMinimo: number;
  diferencia: number;
  estado: EstadoAlerta;
  ultimaFecha: Date | null;
}

/** El saldo de un producto en una sección (sumando todos los lotes) y la fecha de su último movimiento, tal como lo lee la consulta. */
export interface SaldoParaAlerta {
  productoId: string;
  seccionId: string;
  saldo: number;
  ultimaFecha: Date | null;
}

export interface ProductoParaAlerta {
  id: string;
  codigo: string;
  nombre: string;
}

/** Un mínimo cargado: de una sección puntual (`seccionId`) o el global de la sucursal (`seccionId` null). */
export interface MinimoCargado {
  productoId: string;
  seccionId: string | null;
  minimo: number;
}

/**
 * Port de calcularAlertasStock_ (Stock.js:2255-2305): agrega TODO el saldo
 * de un producto+sección (sumando todos los lotes — un lote chico por
 * vencer no puede disparar una alerta falsa si el total de esa MP+sección
 * está bien) y lo compara contra el Stock Mínimo resuelto para esa
 * sección puntual (mismo criterio que resolverStockMinimo, ver
 * stock-minimo.ts: gana la fila de sección si existe, si no la global de
 * la sucursal — acá en memoria, sobre lo ya traído en bloque, para no
 * hacer una query por fila). CRITICO si el saldo llegó a 0 o menos, BAJO
 * si está en o por debajo del mínimo pero todavía positivo, nada si está
 * OK o no hay NINGUNA fila de mínimo cargada para ese producto/sección —
 * "sin mínimo cargado" (null) y "mínimo cargado en 0" (avisame si esto se
 * termina del todo) son cosas distintas, así que solo el primer caso se
 * saltea (antes: `stockMinimo <= 0` trataba a los dos igual, así que un
 * mínimo de 0 con saldo negativo nunca alertaba).
 *
 * A diferencia de Apps Script no incluye "Proveedor Último" (requeriría un
 * join adicional por fila solo para un dato informativo) — simplificación
 * deliberada de esta primera versión, el dato real (quién es el proveedor
 * habitual) ya está en la comparativa de precios de Catálogo.
 */
export function armarAlertasStock(entrada: {
  saldos: readonly SaldoParaAlerta[];
  productos: readonly ProductoParaAlerta[];
  secciones: readonly { id: string; nombre: string }[];
  minimos: readonly MinimoCargado[];
}): FilaAlertaStock[] {
  const { saldos, productos, secciones, minimos } = entrada;
  const productoPorId = new Map(productos.map((p) => [p.id, p]));
  const seccionPorId = new Map(secciones.map((s) => [s.id, s]));

  const minimoPorSeccion = new Map<string, number>(); // `${productoId}||${seccionId}`
  const minimoGlobal = new Map<string, number>(); // productoId
  for (const m of minimos) {
    if (m.seccionId) minimoPorSeccion.set(`${m.productoId}||${m.seccionId}`, m.minimo);
    else minimoGlobal.set(m.productoId, m.minimo);
  }

  const alertas: FilaAlertaStock[] = [];
  for (const s of saldos) {
    const producto = productoPorId.get(s.productoId);
    if (!producto) continue;
    const seccion = seccionPorId.get(s.seccionId);
    if (!seccion) continue;

    const stockMinimo = elegirMinimo(minimoPorSeccion.get(`${s.productoId}||${s.seccionId}`), minimoGlobal.get(s.productoId));
    if (stockMinimo == null) continue; // ninguna fila de mínimo cargada: no hay alerta posible

    const saldoActual = s.saldo;
    if (saldoActual > stockMinimo) continue; // OK: no es una alerta

    alertas.push({
      productoId: producto.id,
      productoCodigo: producto.codigo,
      productoNombre: producto.nombre,
      seccionId: seccion.id,
      seccionNombre: seccion.nombre,
      saldoActual,
      stockMinimo,
      diferencia: saldoActual - stockMinimo,
      estado: saldoActual <= 0 ? "CRITICO" : "BAJO",
      ultimaFecha: s.ultimaFecha,
    });
  }

  return alertas.sort((a, b) => (a.estado === b.estado ? 0 : a.estado === "CRITICO" ? -1 : 1) || a.productoNombre.localeCompare(b.productoNombre) || a.seccionNombre.localeCompare(b.seccionNombre) || (a.seccionId < b.seccionId ? -1 : a.seccionId > b.seccionId ? 1 : 0));
}

export interface ResumenAlertasStock {
  total: number;
  criticos: number;
  bajos: number;
  items: FilaAlertaStock[];
}

/** Port de obtenerResumenAlertasStock (Stock.js:2329-2340), sobre las alertas ya calculadas. */
export function resumirAlertasStock(alertas: readonly FilaAlertaStock[]): ResumenAlertasStock {
  return {
    total: alertas.length,
    criticos: alertas.filter((a) => a.estado === "CRITICO").length,
    bajos: alertas.filter((a) => a.estado === "BAJO").length,
    items: alertas.slice(0, 10),
  };
}
