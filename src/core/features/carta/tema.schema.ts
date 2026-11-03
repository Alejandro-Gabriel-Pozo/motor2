import type { ValoresTema } from "@/core/carta/public";
import type { ResultadoCaso } from "@/core/resultado-caso";

/**
 * Tipos de la feature «tema de la carta» (docs/plan-tema-carta-2026-09-24.md, M8; Hito 5, bloque D, `docs/plan-hito-5-pureza.md` §6.1): los comandos y resultados de los
 * casos de uso de `src/server/actions/carta/casos-de-uso/guardar-tema-carta.ts`, que viene de la Server Action
 * `src/server/actions/carta/tema.ts`. El tema es 1:1 con la sucursal y la acción solo opera sobre la sucursal ACTIVA (el guard lo compara antes de leer).
 */

/** Comando «guardar el tema de una sucursal»: lo que recibe `guardarTemaCartaCasoDeUso`, con los valores YA validados y normalizados por `guardComandoGuardarTemaCarta`. */
export interface ComandoGuardarTemaCarta {
  sucursalId: string;
  valores: ValoresTema;
}

/** Cuántos valores quedaron cargados (el texto del éxito lo nombra); la acción no los expone. */
export interface DatosTemaCartaGuardado {
  cantidad: number;
}

/** `SUCURSAL_NO_ENCONTRADA`: la sucursal activa no se pudo leer (el guard ya descartó cualquier otra). El formato lo rechaza antes el guard. */
export type ResultadoGuardarTemaCarta = ResultadoCaso<DatosTemaCartaGuardado, "SUCURSAL_NO_ENCONTRADA">;
