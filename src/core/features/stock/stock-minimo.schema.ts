import type { ResultadoCaso } from "@/core/resultado-caso";

/**
 * Tipos de la feature «stock mínimo por sucursal × producto (global o de una sección)» (port de setStockMinimoProducto_, Catalogo.js:1982-2008; Hito 4 de la
 * pureza, bloque C de la pieza carta/catálogo/stock, paso H4C-21 — `docs/plan-hito-4-pureza.md` §3): los comandos y resultados de los casos de uso
 * `src/server/actions/stock/casos-de-uso/{set-stock-minimo-producto,eliminar-stock-minimo}.ts`, que vienen de las Server Actions de
 * `src/server/actions/stock/stock-minimo.ts`. Actúan sobre la sucursal ACTIVA (`conPermiso("stock_minimo")`).
 */

/**
 * Comando «fijar el stock mínimo»: el producto (sin validar: lo resuelve la base), el mínimo YA validado (no negativo, número estricto, con tope) y la sección
 * (`null`/`undefined`/vacía = el mínimo GLOBAL de la sucursal, que aplica salvo que haya una fila más específica para una sección).
 */
export interface ComandoSetStockMinimo {
  productoId: string;
  minimo: number;
  seccionId?: string | null;
}

/**
 *  - `PRODUCTO_NO_ENCONTRADO`: no hay un producto con ese id;
 *  - `SECCION_NO_ENCONTRADA`: no hay una sección con ese id en esta sucursal.
 */
export type ResultadoSetStockMinimo = ResultadoCaso<null, "PRODUCTO_NO_ENCONTRADO" | "SECCION_NO_ENCONTRADA">;

/** Comando «borrar una fila de stock mínimo»: el id de la fila, que nunca se validó en la acción. */
export interface ComandoEliminarStockMinimo {
  id: string;
}

/** `NO_ENCONTRADA`: no hay una fila con ese id en esta sucursal. */
export type ResultadoEliminarStockMinimo = ResultadoCaso<null, "NO_ENCONTRADA">;
