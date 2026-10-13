import "server-only";
import { alcanceDeSucursal } from "@/core/catalogo/public";
import { cargarRecetasVigentes } from "@/server/lecturas/catalogo/recetas-vigentes";
import { saldosTeoricosEnSucursal } from "@/server/consultas/stock/stock-teorico";
import type { Db } from "@/lib/db-tipos";

/** Un insumo de la receta de un plato que el sistema registra en 0 o menos en la sucursal. */
export interface InsumoDelPlatoSinStock {
  productoId: string;
  nombre: string;
  unidadNombre: string;
  saldo: number;
}

/**
 * GO-2d (decisión del dueño: el stock teórico AVISA, NUNCA BLOQUEA): de los platos que la carta muestra como disponibles en la sucursal, los ingredientes de su receta VIGENTE en ESA
 * sucursal (la propia si la tiene habilitada, si no la central: `cargarRecetasVigentes`, el lector único de la receta) que el sistema registra en 0 o menos. La pantalla lo dice («el
 * sistema dice 0; si hay en el depósito, hacé un conteo físico») y el plato sigue en la carta: el sistema puede decir 0 y haber stock de verdad. Tres consultas para todos los platos
 * (recetas, saldos y nombres), sin N+1. Un plato sin receta no avisa nada (que se pueda vender sin receta lo decide otra regla). Sin guarda de permiso adentro: la pone la página.
 */
export async function insumosSinStockDeLosPlatos(db: Db, sucursalId: string, productoIds: readonly string[]): Promise<Map<string, InsumoDelPlatoSinStock[]>> {
  if (productoIds.length === 0) return new Map();
  const recetas = await cargarRecetasVigentes(db, alcanceDeSucursal(sucursalId), { where: { productoId: { in: [...productoIds] } }, include: { ingredientes: { select: { insumoProductoId: true } } } });
  const insumoIds = [...new Set([...recetas.values()].flatMap((r) => r.ingredientes.map((i) => i.insumoProductoId)))];
  if (insumoIds.length === 0) return new Map();
  const [saldos, insumos] = await Promise.all([
    saldosTeoricosEnSucursal(sucursalId, insumoIds, db),
    db.producto.findMany({ where: { id: { in: insumoIds } }, select: { id: true, nombre: true, unidadStock: { select: { nombre: true } } } }),
  ]);
  const porId = new Map(insumos.map((i) => [i.id, i]));
  const salida = new Map<string, InsumoDelPlatoSinStock[]>();
  for (const [productoId, receta] of recetas) {
    const sinStock = [...new Set(receta.ingredientes.map((i) => i.insumoProductoId))].flatMap((id) => {
      const saldo = saldos.get(id) ?? 0;
      const insumo = porId.get(id);
      return saldo <= 0 && insumo ? [{ productoId: id, nombre: insumo.nombre, unidadNombre: insumo.unidadStock.nombre, saldo }] : [];
    });
    if (sinStock.length) salida.set(productoId, sinStock);
  }
  return salida;
}
