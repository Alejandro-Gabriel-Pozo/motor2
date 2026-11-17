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

/**
 * Comando «guardar la pantalla simple del tema» (PASO A de «Apariencia y publicación», `docs/diseno-carta-apariencia-y-publicacion-como-pedernal-2026-11-17.md`): solo las siete claves de `CLAVES_TEMA_SIMPLE`, YA validadas y
 * normalizadas por `guardComandoGuardarTemaSimpleCarta` (una clave ausente = vacía = se saca), y la versión que vio la pantalla (`actualizadoEn` en ISO del tema, o `sin-tema` si la sucursal no tenía).
 */
export interface ComandoGuardarTemaSimpleCarta {
  sucursalId: string;
  valores: ValoresTema;
  versionEsperada: string;
}

/** `cambiado`: `false` si lo pedido ya era lo guardado (no se escribió ni se versionó nada). */
export interface DatosTemaSimpleCartaGuardado {
  cambiado: boolean;
}

/** `SUCURSAL_NO_ENCONTRADA`: la sucursal activa no se pudo leer. `RUBRO_DEMASIADO_LARGO`: el rubro nuevo pasa de 40 (el de Pedernal; solo si cambia). `VERSION_DESACTUALIZADA`: otra persona cambió el tema mientras se editaba (no se escribió nada). */
export type ResultadoGuardarTemaSimpleCarta = ResultadoCaso<DatosTemaSimpleCartaGuardado, "SUCURSAL_NO_ENCONTRADA" | "VERSION_DESACTUALIZADA" | "RUBRO_DEMASIADO_LARGO">;
