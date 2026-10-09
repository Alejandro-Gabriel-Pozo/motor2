import type { ResultadoCaso } from "@/core/resultado-caso";

/**
 * Tipos de la feature «cancelar un conteo físico» (Task #41, Fase M, M13e2 — docs/arquitectura-casos-de-uso-2026-09-27.md). Revierte
 * un conteo YA APLICADO (estado RESUELTO): escribe una fila de reversión en el Kardex (misma magnitud, signo contrario) si el conteo
 * había ajustado algo, y lo marca CANCELADO.
 *
 * El formato (`conteoId` es un texto no vacío) lo valida `guardComandoCancelarConteo` (`cancelar-conteo.guard.ts`); el resto depende de
 * datos de base y se queda en el caso de uso (`casos-de-uso/cancelar-conteo-fisico.ts`).
 */
export interface ComandoCancelarConteo {
  conteoId: string;
}

export type CodigoCancelarConteo = "CONTEO_NO_ENCONTRADO" | "CONTEO_YA_CANCELADO" | "CONTEO_NO_RESUELTO";

/** `datos` de un conteo cancelado con éxito. */
export interface DatosCancelarConteo {
  /** Lo que el conteo había APLICADO al stock y la cancelación revirtió (S-04: la suma de sus líneas del Kardex, no `conteo.diferencia`); 0 = no aplicó nada y no se tocó el stock. */
  ajusteRevertido: number;
}

export type ResultadoCancelarConteo = ResultadoCaso<DatosCancelarConteo, CodigoCancelarConteo>;
