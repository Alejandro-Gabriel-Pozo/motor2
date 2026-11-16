import "server-only";
import type { Db } from "@/lib/db-tipos";

/**
 * El «Nombre de cocina» (2026-11-15; `docs/diseno-nombre-de-cocina-como-pedernal-2026-11-15.md`) de los productos de un pedido, para CONGELARLO en la línea (`CuentaItem.nombreDeCocina`) al agregarla: la comanda, su
 * reimpresión y el aviso de anulación lo usan, y salen iguales aunque después se renombre el producto o se cambie su nombre de cocina. Se lee con la base de LA MISMA transacción que escribe las líneas (sin carrera
 * entre leer y escribir) y del producto de la empresa de la sesión (la base filtra por empresa). Los productos sin nombre de cocina no figuran: su línea queda en `null` y la comanda usa el nombre interno.
 * Una sola lectura por pedido, sin importar cuántos productos lleve.
 */
export async function cargarNombresDeCocina(db: Db, productoIds: readonly string[]): Promise<Map<string, string>> {
  if (productoIds.length === 0) return new Map();
  const filas = await db.producto.findMany({ where: { id: { in: [...new Set(productoIds)] }, nombreDeCocina: { not: null } }, select: { id: true, nombreDeCocina: true } });
  return new Map(filas.flatMap((f) => (f.nombreDeCocina === null ? [] : [[f.id, f.nombreDeCocina] as const])));
}
