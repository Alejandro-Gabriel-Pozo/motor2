"use server";

import { guardComandoSetStockMinimo } from "@/core/features/stock/stock-minimo.guard";
import { aResultadoAccion } from "@/core/resultado-caso";
import { conPermiso } from "../con-permiso";
import { error, type ResultadoAccion } from "../tipos";
import { requerirVerEnSucursal } from "../con-sesion";
import { eliminarStockMinimoCasoDeUso } from "./casos-de-uso/eliminar-stock-minimo";
import { setStockMinimoProductoCasoDeUso } from "./casos-de-uso/set-stock-minimo-producto";

/**
 * Desde el Hito 4 de la pureza (bloque C de la pieza carta/catálogo/stock, paso H4C-21) las dos mutaciones son adaptadores finos de sus casos de uso
 * (`./casos-de-uso/{set-stock-minimo-producto,eliminar-stock-minimo}.ts`; escrituras en server/persistencia/stock/stock-minimo.ts): el archivo entero está en
 * `ACCIONES_CON_CASO_DE_USO`. La lectura (H8) sigue acá con su guarda. Ninguna refresca la vista (como antes). Desde 4.4 (H4C-22) el alta, el cambio y el borrado
 * del mínimo se auditan en la transacción de su caso de uso (entidad «StockMinimoProducto»).
 */

/** Todas las filas (global + por sección) de Stock Mínimo de esta sucursal — para el panel de administración. */
export async function listarStockMinimo(sucursalId: string) {
  const ctx = await requerirVerEnSucursal(sucursalId, "stock_minimo");
  return ctx.db.stockMinimoProducto.findMany({
    where: { sucursalId },
    // S-15 (plan de endurecimiento, T7): solo lo que el panel dibuja (el `Producto` entero llevaba el costo de consignación a quien invoca la acción a mano). Más campos: se AGREGAN acá (GT-3a).
    select: { id: true, productoId: true, seccionId: true, minimo: true, producto: { select: { codigo: true, nombre: true } }, seccion: { select: { nombre: true } } },
    orderBy: [{ producto: { nombre: "asc" } }],
  });
}

/**
 * Port de setStockMinimoProducto_ (Catalogo.js:1982-2008). `seccionId`
 * null/omitido = fija el mínimo GLOBAL de esta sucursal (aplica salvo que
 * haya una fila más específica para una sección puntual).
 *
 * Desde el Hito 4 (H4C-21): permiso → formato del mínimo (`guardComandoSetStockMinimo`, core/features/stock/stock-minimo.guard.ts, DENTRO del envoltorio) → caso de
 * uso (`casos-de-uso/set-stock-minimo-producto.ts`: el producto, la sección y el alta o cambio de la fila) → `aResultadoAccion`.
 */
export async function setStockMinimoProducto(productoId: string, minimo: number, seccionId?: string | null): Promise<ResultadoAccion> {
  return conPermiso("stock_minimo", async (ctx) => {
    const comando = guardComandoSetStockMinimo({ productoId, minimo, seccionId });
    if (!comando.ok) return error(comando.mensaje);
    return aResultadoAccion(await setStockMinimoProductoCasoDeUso(ctx, comando.valor));
  });
}

/** Desde el Hito 4 (H4C-21): permiso → caso de uso (`casos-de-uso/eliminar-stock-minimo.ts`) → `aResultadoAccion`. Sin guard (`SIN_GUARD`: solo recibe un id). */
export async function eliminarStockMinimo(id: string): Promise<ResultadoAccion> {
  return conPermiso("stock_minimo", async (ctx) => {
    return aResultadoAccion(await eliminarStockMinimoCasoDeUso(ctx, { id }));
  });
}
