import type { ResultadoCaso } from "@/core/resultado-caso";

/**
 * Tipos de la feature «Sección habitual de un producto de venta en la sucursal» (docs/plan-seccion-habitual-stock-2026-09-25.md, C1/C2; Hito 4 de la pureza,
 * bloque C de la pieza carta/catálogo/stock, paso H4C-20 — `docs/plan-hito-4-pureza.md` §3): los comandos y resultados de los casos de uso
 * `src/server/actions/stock/casos-de-uso/{set-seccion-habitual,eliminar-seccion-habitual}.ts`, que vienen de las Server Actions de
 * `src/server/actions/stock/seccion-habitual.ts`. Actúan sobre la sucursal ACTIVA (`conPermiso("stock_seccion_habitual")`).
 */

/** Comando «fijar la sección habitual»: el producto y la sección elegidos, ids de texto no vacíos y recortados (`guardComandoSeccionHabitual`). */
export interface ComandoSeccionHabitual {
  productoId: string;
  seccionId: string;
}

/**
 *  - `PRODUCTO_NO_ENCONTRADO`: no hay un producto con ese id;
 *  - `NO_ES_PV`: el producto es una materia prima (solo un PV tiene sección habitual);
 *  - `SECCION_NO_ENCONTRADA`: no hay una sección con ese id en esta sucursal;
 *  - `SECCION_INACTIVA`: la sección está desactivada.
 */
export type ResultadoSetSeccionHabitual = ResultadoCaso<null, "PRODUCTO_NO_ENCONTRADO" | "NO_ES_PV" | "SECCION_NO_ENCONTRADA" | "SECCION_INACTIVA">;

/** Comando «quitar la sección habitual»: el id de la fila, ya visto como texto (`guardComandoEliminarSeccionHabitual`). */
export interface ComandoEliminarSeccionHabitual {
  id: string;
}

/** `NO_ENCONTRADA`: no hay una fila con ese id en esta sucursal. */
export type ResultadoEliminarSeccionHabitual = ResultadoCaso<null, "NO_ENCONTRADA">;
