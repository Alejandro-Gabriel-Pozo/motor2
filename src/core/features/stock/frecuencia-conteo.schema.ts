import type { ResultadoCaso } from "@/core/resultado-caso";

/**
 * Tipos de la feature «agenda de conteo físico por sucursal × producto» (sub-plan S, docs/plan-rendimiento-recetas-2026-09-22.md §E; Hito 4 de la pureza, bloque C de
 * la pieza carta/catálogo/stock, paso H4C-19 — `docs/plan-hito-4-pureza.md` §3): los comandos y resultados de los casos de uso
 * `src/server/actions/stock/casos-de-uso/{set-frecuencia-conteo,eliminar-frecuencia-conteo}.ts`, que vienen de las Server Actions de
 * `src/server/actions/stock/frecuencia-conteo.ts`. Actúan sobre la sucursal ACTIVA (`conPermiso("conteo_frecuencia")`).
 */

/** Comando «fijar cada cuántos días se cuenta un producto»: el producto (sin validar: lo resuelve la base) y los días YA validados (entero, 0 o más, con tope). */
export interface ComandoSetFrecuenciaConteo {
  productoId: string;
  frecuenciaDias: number;
}

/** `PRODUCTO_NO_ENCONTRADO`: no hay un producto con ese id. */
export type ResultadoSetFrecuenciaConteo = ResultadoCaso<null, "PRODUCTO_NO_ENCONTRADO">;

/** Comando «borrar la fila de la agenda»: el id de la fila, que nunca se validó en la acción. */
export interface ComandoEliminarFrecuenciaConteo {
  id: string;
}

/** `NO_ENCONTRADA`: no hay una fila con ese id en esta sucursal. */
export type ResultadoEliminarFrecuenciaConteo = ResultadoCaso<null, "NO_ENCONTRADA">;
