import "server-only";
import { whereCartaDeSucursal } from "@/core/carta/public";
import type { Db } from "@/lib/db-tipos";

/**
 * La sección de la carta de ESTA sucursal de cada producto que se le pasa (la lista de Productos la dice en cada fila: «Producto vendible · Platos»). Solo los que tienen contenido de carta con sección; el resto no
 * figura en el mapa (la pantalla dice «—»). Lee solo la carta PROPIA de la sucursal (`whereCartaDeSucursal`). Quien llama decide si quien mira ve la carta (permiso y módulo): acá no se revela nada más que el nombre de una sección.
 */
export async function seccionDeCartaDeLosProductos(db: Db, sucursalId: string, productoIds: readonly string[]): Promise<ReadonlyMap<string, string>> {
  if (productoIds.length === 0) return new Map();
  const filas = await db.contenidoCartaProducto.findMany({
    where: { ...whereCartaDeSucursal(sucursalId), productoId: { in: [...productoIds] }, seccionCartaId: { not: null } },
    select: { productoId: true, seccionCarta: { select: { nombre: true } } },
  });
  return new Map(filas.flatMap((f) => (f.seccionCarta ? [[f.productoId, f.seccionCarta.nombre] as const] : [])));
}
