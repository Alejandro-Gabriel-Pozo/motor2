import type { OrigenNormalizado } from "@/core/catalogo/public";
import type { ResultadoCaso } from "@/core/resultado-caso";

/**
 * Tipos de la feature «rendimiento local de una línea de receta» (D4 de docs/plan-rendimiento-receta-por-sucursal-2026-09-26.md; Hito 4 de la pureza, bloque 4.2,
 * paso H4C-5 — `docs/plan-hito-4-pureza.md` §3): los comandos y resultados de los casos de uso de `src/server/actions/catalogo/casos-de-uso/` que vienen de la
 * Server Action `src/server/actions/catalogo/rendimiento-local.ts`. Mismo criterio que `core/features/mesas/mesas.schema.ts`.
 */

/**
 * Comando «calibrar el rendimiento de una línea en la sucursal activa»: lo que recibe `fijarRendimientoLocalCasoDeUso`, YA validado por
 * `guardComandoFijarRendimientoLocal` (cantidad mayor a 0 y bajo el tope o `null`, merma entre 0 y 9999,99 o `null`, no las dos en `null`) y con el origen de la
 * sugerencia ya normalizado y comprobado contra la sucursal activa (o `null` si es una edición manual).
 */
export interface ComandoFijarRendimientoLocal {
  recetaIngredienteId: string;
  cantidad: number | null;
  mermaPorcentaje: number | null;
  origen: OrigenNormalizado | null;
}

/**
 *  - `LINEA_NO_ENCONTRADA`: el id no es de una línea de receta;
 *  - `RECETA_CAMBIADA`: la línea ya no es de la versión vigente de su receta (o la transacción serializable agotó sus reintentos contra un guardado concurrente).
 */
export type ResultadoFijarRendimientoLocal = ResultadoCaso<null, "LINEA_NO_ENCONTRADA" | "RECETA_CAMBIADA">;

/** Comando «volver al valor central»: solo el id de la línea, que nunca se validó en la acción (sin guard: lo resuelve el caso de uso). */
export interface ComandoVolverAlRendimientoCentral {
  recetaIngredienteId: string;
}

/**
 * `huboCambio`: si el caso de uso escribió (la línea tenía una calibración). Es `false` cuando la línea ya usaba el valor central: ese camino no escribe y la Server
 * Action no refresca la vista (como antes de la mudanza).
 */
export type ResultadoVolverAlRendimientoCentral = ResultadoCaso<{ huboCambio: boolean }, "LINEA_NO_ENCONTRADA" | "RECETA_CAMBIADA">;
