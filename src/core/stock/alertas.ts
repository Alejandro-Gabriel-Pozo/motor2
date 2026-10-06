import type { Prisma, PrismaClient } from "@prisma/client";
import { elegirMinimo } from "./stock-minimo";

type Db = PrismaClient | Prisma.TransactionClient;

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
export async function calcularAlertasStock(sucursalId: string, db: Db): Promise<FilaAlertaStock[]> {
  const saldos = await db.movimientoStock.groupBy({
    by: ["productoId", "seccionId"],
    where: { seccion: { sucursalId } },
    _sum: { cantidad: true },
    _max: { creadoEn: true },
  });
  if (!saldos.length) return [];

  const productoIds = Array.from(new Set(saldos.map((s) => s.productoId)));
  const [productos, secciones, minimos] = await Promise.all([
    db.producto.findMany({ where: { id: { in: productoIds } } }),
    db.seccion.findMany({ where: { sucursalId } }),
    db.stockMinimoProducto.findMany({ where: { sucursalId, productoId: { in: productoIds } } }),
  ]);
  const productoPorId = new Map(productos.map((p) => [p.id, p]));
  const seccionPorId = new Map(secciones.map((s) => [s.id, s]));

  const minimoPorSeccion = new Map<string, number>(); // `${productoId}||${seccionId}`
  const minimoGlobal = new Map<string, number>(); // productoId
  for (const m of minimos) {
    if (m.seccionId) minimoPorSeccion.set(`${m.productoId}||${m.seccionId}`, Number(m.minimo));
    else minimoGlobal.set(m.productoId, Number(m.minimo));
  }

  const alertas: FilaAlertaStock[] = [];
  for (const s of saldos) {
    const producto = productoPorId.get(s.productoId);
    if (!producto) continue;
    const seccion = seccionPorId.get(s.seccionId);
    if (!seccion) continue;

    const stockMinimo = elegirMinimo(minimoPorSeccion.get(`${s.productoId}||${s.seccionId}`), minimoGlobal.get(s.productoId));
    if (stockMinimo == null) continue; // ninguna fila de mínimo cargada: no hay alerta posible

    const saldoActual = Number(s._sum.cantidad ?? 0);
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
      ultimaFecha: s._max.creadoEn,
    });
  }

  return alertas.sort((a, b) => (a.estado === b.estado ? 0 : a.estado === "CRITICO" ? -1 : 1) || a.productoNombre.localeCompare(b.productoNombre));
}

export interface ResumenAlertasStock {
  total: number;
  criticos: number;
  bajos: number;
  items: FilaAlertaStock[];
}

/** Port de obtenerResumenAlertasStock (Stock.js:2329-2340). */
export async function obtenerResumenAlertasStock(sucursalId: string, db: Db): Promise<ResumenAlertasStock> {
  const data = await calcularAlertasStock(sucursalId, db);
  return {
    total: data.length,
    criticos: data.filter((a) => a.estado === "CRITICO").length,
    bajos: data.filter((a) => a.estado === "BAJO").length,
    items: data.slice(0, 10),
  };
}
