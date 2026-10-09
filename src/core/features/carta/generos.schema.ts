import type { ResultadoCaso } from "@/core/resultado-caso";

/**
 * Tipos de la feature «géneros de carta» (docs/plan-genero-carta-2026-09-26.md; Hito 5, bloque D, `docs/plan-hito-5-pureza.md` §6.1): los comandos y resultados de
 * los casos de uso de `src/server/actions/carta/casos-de-uso/{guardar-genero-carta,actualizar-activo-genero-carta}.ts`, que vienen de la Server Action
 * `src/server/actions/carta/generos.ts`. Los géneros son carpetas VISUALES del POS y PROPIOS de cada sucursal (ADR-009, C3): todo actúa sobre la sucursal ACTIVA.
 */

/** Comando «guardar un género» (alta sin `id`, edición con `id`): lo que recibe `guardarGeneroCartaCasoDeUso`, con el nombre y el orden YA validados por `guardComandoGuardarGeneroCarta`. */
export interface ComandoGuardarGeneroCarta {
  id?: string;
  nombre: string;
  orden: number;
}

/** El id y el nombre del género guardado (creado o editado), para el `ResultadoConId` de la Server Action. */
export interface DatosGeneroCartaGuardado {
  id: string;
  nombre: string;
}

/**
 * Solo lo que produce el caso de uso (el formato lo rechaza antes el guard):
 *  - `NOMBRE_REPETIDO`: OTRO género de esta sucursal ya tiene ese nombre (sin distinguir mayúsculas); gana sobre `GENERO_NO_ENCONTRADO`;
 *  - `GENERO_NO_ENCONTRADO`: el género a editar no existe en esta sucursal (uno de otra sucursal responde igual que uno inexistente).
 */
export type ResultadoGuardarGeneroCarta = ResultadoCaso<DatosGeneroCartaGuardado, "NOMBRE_REPETIDO" | "GENERO_NO_ENCONTRADO">;

/** Comando «apagar o prender un género»: solo un id y un booleano, que nunca se validaron en la acción (el id lo resuelve el caso de uso). */
export interface ComandoActualizarActivoGeneroCarta {
  generoCartaId: string;
  activo: boolean;
}

/** `GENERO_NO_ENCONTRADO`: el id no es de un género de esta sucursal (la acción no revalida la carta en ese camino). */
export type ResultadoActualizarActivoGeneroCarta = ResultadoCaso<null, "GENERO_NO_ENCONTRADO">;
