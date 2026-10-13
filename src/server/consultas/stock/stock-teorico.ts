import "server-only";
import type { Db } from "@/lib/db-tipos";

/**
 * El STOCK TEÓRICO (lo que dice el sistema) de unos productos en UNA sucursal: la suma del libro de stock (`MovimientoStock.cantidad`) de todas sus secciones, la misma cuenta que el
 * «teórico» del stock consolidado (`calcularStockConsolidado`), pero solo para los productos pedidos y en UN agregado (sin N+1). Falla cerrado por sucursal: la sección tiene que ser
 * de la sucursal que se pide (en el mismo `where`), además de la RLS por sucursal. Un producto sin movimientos acá no vuelve: su saldo es 0.
 *
 * GO-2d (decisión del dueño): el stock teórico AVISA, NUNCA BLOQUEA. Lo usan las pantallas que marcan algo como disponible («Opciones agotadas», la carta) para decir «el sistema
 * dice 0; si hay en el depósito, hacé un conteo físico», sin impedir nada. Sin guarda de permiso adentro: la pone la página.
 */
export async function saldosTeoricosEnSucursal(sucursalId: string, productoIds: readonly string[], db: Db): Promise<Map<string, number>> {
  const ids = [...new Set(productoIds)];
  if (ids.length === 0) return new Map();
  const filas = await db.movimientoStock.groupBy({ by: ["productoId"], where: { productoId: { in: ids }, seccion: { sucursalId } }, _sum: { cantidad: true } });
  return new Map(filas.map((f) => [f.productoId, Number(f._sum.cantidad ?? 0)]));
}
