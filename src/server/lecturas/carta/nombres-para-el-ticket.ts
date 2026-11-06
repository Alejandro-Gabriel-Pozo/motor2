import "server-only";
import { whereCartaDeSucursal } from "@/core/carta/public";
import type { Db } from "@/lib/db-tipos";
import { MODO_DE_VENTA } from "@/core/opciones/public";

/**
 * El «Nombre en la carta» (2026-11-04) de los productos DIRECTOS de un pedido en la sucursal, para CONGELARLO en la línea (`CuentaItem.nombreEnTicket`) al vender: el ticket del cliente lo imprime y
 * una reimpresión sale igual aunque después se cambie el nombre. Los productos base no entran (su línea se nombra con el rótulo de la medida) ni los que no tienen nombre en la carta (salen con el interno).
 * Una sola lectura por pedido, sin importar cuántos productos lleve.
 */
export async function cargarNombresDeCartaParaElTicket(db: Db, args: { sucursalId: string; productoIds: readonly string[] }): Promise<Map<string, string>> {
  if (args.productoIds.length === 0) return new Map();
  const filas = await db.contenidoCartaProducto.findMany({
    where: { ...whereCartaDeSucursal(args.sucursalId), productoId: { in: [...new Set(args.productoIds)] }, nombreEnCarta: { not: null }, producto: { modoDeVenta: { not: MODO_DE_VENTA.BASE_CONFIGURABLE } } },
    select: { productoId: true, nombreEnCarta: true },
  });
  return new Map(filas.flatMap((f) => (f.nombreEnCarta === null ? [] : [[f.productoId, f.nombreEnCarta] as const])));
}
