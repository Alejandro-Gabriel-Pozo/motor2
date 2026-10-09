import type { ResultadoCaso } from "@/core/resultado-caso";

/**
 * Tipos de la feature «receta PROPIA de la sucursal» (ADR-009, familia override, R3/R4; Hito 4 de la pureza, bloque 4.2, paso H4C-6 — `docs/plan-hito-4-pureza.md`
 * §3): el comando y el resultado de `volverALaRecetaCentralCasoDeUso` (`src/server/actions/catalogo/casos-de-uso/volver-a-la-receta-central.ts`), que viene de
 * la Server Action `volverALaRecetaCentral` (`src/server/actions/catalogo/receta-sucursal.ts`). Las demás acciones de la receta propia (crear, agregar, editar,
 * quitar, copiar) escriben por `guardar-version-de-receta` y usan sus tipos (`receta-version.schema.ts`).
 */

/** Comando «volver a la receta central»: el producto, con la confirmación YA exigida por `guardComandoVolverALaRecetaCentral`. */
export interface ComandoVolverALaRecetaCentral {
  productoId: string;
}

/**
 *  - `SIN_RECETA_PROPIA`: la sucursal activa no tiene receta propia HABILITADA para el producto (nunca la tuvo, o ya volvió a la central);
 *  - `RECETA_CAMBIADA`: la transacción serializable agotó sus reintentos contra un cambio concurrente de la receta.
 */
export type ResultadoVolverALaRecetaCentral = ResultadoCaso<null, "SIN_RECETA_PROPIA" | "RECETA_CAMBIADA">;
