import type { ValoresTema } from "@/core/carta/public";
import type { ResultadoCaso } from "@/core/resultado-caso";

/**
 * Tipos de la feature «tema de la carta» (docs/plan-tema-carta-2026-09-24.md, M8; Hito 5, bloque D, `docs/plan-hito-5-pureza.md` §6.1): los comandos y resultados de los
 * casos de uso de `src/server/actions/carta/casos-de-uso/{guardar-tema-carta,cambiar-aplicacion-tema}.ts`, que vienen de la Server Action
 * `src/server/actions/carta/tema.ts`. El tema es 1:1 con la sucursal y las dos acciones solo operan sobre la sucursal ACTIVA (el guard lo compara antes de leer).
 */

/** Comando «guardar el tema de una sucursal»: lo que recibe `guardarTemaCartaCasoDeUso`, con los valores YA validados y normalizados por `guardComandoGuardarTemaCarta`. */
export interface ComandoGuardarTemaCarta {
  sucursalId: string;
  valores: ValoresTema;
}

/** Cuántos valores quedaron cargados y si el tema ya estaba aplicado en la carta (el texto del éxito lo nombra); la acción no los expone. */
export interface DatosTemaCartaGuardado {
  cantidad: number;
  aplicadoEnCarta: boolean;
}

/** `SUCURSAL_NO_ENCONTRADA`: la sucursal activa no se pudo leer (el guard ya descartó cualquier otra). El formato lo rechaza antes el guard. */
export type ResultadoGuardarTemaCarta = ResultadoCaso<DatosTemaCartaGuardado, "SUCURSAL_NO_ENCONTRADA">;

/** Comando «aplicar o desaplicar el tema de la sucursal activa». */
export interface ComandoCambiarAplicacionTema {
  sucursalId: string;
  aplicar: boolean;
}

/**
 * Solo lo que produce el caso de uso (que la sucursal sea la activa lo rechaza antes el guard):
 *  - `TEMA_NO_ENCONTRADO`: la sucursal todavía no tiene tema guardado (gana tanto al aplicar como al desaplicar);
 *  - `TEMA_VACIO`: aplicar exige al menos un valor válido guardado (desaplicar un tema vacío sí se puede).
 */
export type ResultadoCambiarAplicacionTema = ResultadoCaso<null, "TEMA_NO_ENCONTRADO" | "TEMA_VACIO">;
