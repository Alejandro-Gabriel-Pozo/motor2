import type { ResultadoCaso } from "@/core/resultado-caso";

/**
 * Tipos de la feature Mesas del salón (módulo POS; Hito 4 de la pureza, bloque 4.1 — `docs/plan-hito-4-pureza.md` §5): los comandos y resultados de los
 * casos de uso de `src/server/actions/pos/casos-de-uso/` que vienen de `src/server/actions/pos/mesas.ts` (alta de una mesa y límite de mesas abiertas). Mismo
 * criterio que `core/features/cuentas/cuenta.schema.ts`.
 */

/** Comando «dar de alta una mesa»: lo que recibe `crearMesaCasoDeUso`, con el número YA validado por `guardComandoCrearMesa` (entero entre 1 y 9999). */
export interface ComandoCrearMesa {
  numero: number;
}

/**
 * Solo lo que produce el caso de uso (un número fuera de rango lo rechaza antes el guard):
 *  - `NUMERO_REPETIDO`: ya hay una mesa con ese número en la sucursal (el índice único `(sucursalId, numero)` lo detecta en la base).
 */
export type ResultadoCrearMesa = ResultadoCaso<null, "NUMERO_REPETIDO">;

/**
 * Comando «fijar el límite de mesas abiertas de la sucursal»: lo que recibe `actualizarMaxMesasAbiertasCasoDeUso`, con el límite YA validado por
 * `guardComandoActualizarMaxMesasAbiertas` (`null` = sin límite; si no, entero entre 1 y 9999).
 */
export interface ComandoActualizarMaxMesasAbiertas {
  limite: number | null;
}

/** El caso de uso no rechaza nada propio: el formato lo rechaza antes el guard y la sucursal es la activa (si no existiera, lanza, como antes). */
export type ResultadoActualizarMaxMesasAbiertas = ResultadoCaso<null, never>;
