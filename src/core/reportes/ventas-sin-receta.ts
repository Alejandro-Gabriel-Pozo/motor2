import { prisma } from "@/lib/db";
import { construirMapaProductos, type Db } from "./comun";

export interface FilaVentaSinReceta {
  productoId: string;
  producto: string;
  codigo: string;
  cantidadVentasSinReceta: number;
  primeraFecha: Date;
  ultimaFecha: Date;
}

/**
 * Port de generarReporteVentasSinReceta_ (Reportes.js:1063-1112) — un PV se
 * puede vender sin receta cargada (la venta se registra igual, no
 * descuenta stock de ninguna MP). Cada venta es su propia Operacion
 * (registrarVenta, venta.ts) que comparte `operacionId` con sus líneas
 * CONSUMO si la receta generó alguna — así que "venta sin receta" es,
 * directo, una fila VENTA cuya Operacion no tiene ninguna fila CONSUMO
 * asociada (acá se resuelve con una FK real, no comparando IDs de texto).
 */
export async function generarReporteVentasSinReceta(sucursalId: string, db: Db = prisma): Promise<FilaVentaSinReceta[]> {
  const ventas = await db.movimientoStock.findMany({
    where: { proceso: "VENTA", seccion: { sucursalId } },
    select: { productoId: true, operacionId: true, operacion: { select: { fecha: true } } },
  });
  if (!ventas.length) return [];

  const operacionIds = Array.from(new Set(ventas.map((v) => v.operacionId)));
  const consumos = await db.movimientoStock.findMany({
    where: { proceso: "CONSUMO", operacionId: { in: operacionIds } },
    select: { operacionId: true },
    distinct: ["operacionId"],
  });
  const operacionesConConsumo = new Set(consumos.map((c) => c.operacionId));

  const productos = await construirMapaProductos(undefined, db);
  const porProducto = new Map<string, { cantidadVentasSinReceta: number; primeraFecha: Date; ultimaFecha: Date }>();

  for (const v of ventas) {
    const info = productos.get(v.productoId);
    if (!info || info.tipo !== "PV") continue;
    if (operacionesConConsumo.has(v.operacionId)) continue; // esta venta puntual sí generó consumo: no es "sin receta"

    const fecha = v.operacion.fecha;
    if (!porProducto.has(v.productoId)) porProducto.set(v.productoId, { cantidadVentasSinReceta: 0, primeraFecha: fecha, ultimaFecha: fecha });
    const acc = porProducto.get(v.productoId)!;
    acc.cantidadVentasSinReceta += 1;
    if (fecha < acc.primeraFecha) acc.primeraFecha = fecha;
    if (fecha > acc.ultimaFecha) acc.ultimaFecha = fecha;
  }

  return Array.from(porProducto.entries())
    .map(([productoId, acc]) => ({ productoId, producto: productos.get(productoId)!.nombre, codigo: productos.get(productoId)!.codigo, ...acc }))
    .sort((a, b) => b.ultimaFecha.getTime() - a.ultimaFecha.getTime());
}
