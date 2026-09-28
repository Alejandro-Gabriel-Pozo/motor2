import type { ResultadoCaso } from "@/core/resultado-caso";

/**
 * Tipos de la feature «cancelar un conteo físico» (Task #41, Fase M, M13e2 — docs/arquitectura-casos-de-uso-2026-09-27.md). Revierte
 * un conteo YA APLICADO (estado RESUELTO): escribe una fila de reversión en el Kardex (misma magnitud, signo contrario) si el conteo
 * había ajustado algo, y lo marca CANCELADO.
 *
 * Sin `.guard.ts` propio, mismo criterio que `resolver-conteo.schema.ts`: `conteoId` es un id opaco, sin ningún formato que validar
 * antes de la transacción — se queda todo en el caso de uso (`casos-de-uso/cancelar-conteo-fisico.ts`).
 */
export type CodigoCancelarConteo = "CONTEO_NO_ENCONTRADO" | "CONTEO_YA_CANCELADO" | "CONTEO_NO_RESUELTO";

/** `datos` de un conteo cancelado con éxito. */
export interface DatosCancelarConteo {
  /** El ajuste que tenía el conteo original (0 = no había nada que revertir en el Kardex). */
  diferenciaOriginal: number;
}

export type ResultadoCancelarConteo = ResultadoCaso<DatosCancelarConteo, CodigoCancelarConteo>;
