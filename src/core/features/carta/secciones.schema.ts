import type { ResultadoCaso } from "@/core/resultado-caso";

/**
 * Tipos de la feature «secciones de carta» (docs/plan-carta-catalogo-2026-09-24.md, M9; Hito 5, bloque D, `docs/plan-hito-5-pureza.md` §6.1): los comandos y
 * resultados de los casos de uso de `src/server/actions/carta/casos-de-uso/{guardar-seccion-carta,actualizar-activa-seccion-carta}.ts`, que vienen de la Server
 * Action `src/server/actions/carta/secciones.ts`. Las secciones son de la EMPRESA (decisión D4), no de la sucursal. Mismo criterio que `promos.schema.ts`.
 */

/**
 * Comando «guardar una sección de carta» (alta sin `id`, edición con `id`): lo que recibe `guardarSeccionCartaCasoDeUso`, con los datos YA validados por
 * `guardComandoGuardarSeccionCarta` (nombre recortado y válido, título y descripción en largo o `null`, imagen segura o `null`, orden entero).
 */
export interface ComandoGuardarSeccionCarta {
  id?: string;
  nombre: string;
  titulo: string | null;
  descripcion: string | null;
  imagenUrl: string | null;
  orden: number;
}

/** El id y el nombre de la sección guardada (creada o editada), para el `ResultadoConId` de la Server Action. */
export interface DatosSeccionCartaGuardada {
  id: string;
  nombre: string;
}

/**
 * Solo lo que produce el caso de uso (el formato lo rechaza antes el guard):
 *  - `NOMBRE_REPETIDO`: OTRA sección de la empresa ya tiene ese nombre (sin distinguir mayúsculas); gana sobre `SECCION_NO_ENCONTRADA`;
 *  - `SECCION_NO_ENCONTRADA`: la sección a editar no existe.
 */
export type ResultadoGuardarSeccionCarta = ResultadoCaso<DatosSeccionCartaGuardada, "NOMBRE_REPETIDO" | "SECCION_NO_ENCONTRADA">;

/** Comando «apagar o prender una sección de carta»: solo un id y un booleano, que nunca se validaron en la acción (el id lo resuelve el caso de uso). */
export interface ComandoActualizarActivaSeccionCarta {
  seccionCartaId: string;
  activa: boolean;
}

/** `SECCION_NO_ENCONTRADA`: el id no es de una sección de la empresa (la acción no revalida la carta en ese camino). */
export type ResultadoActualizarActivaSeccionCarta = ResultadoCaso<null, "SECCION_NO_ENCONTRADA">;
