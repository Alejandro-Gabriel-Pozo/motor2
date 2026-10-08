import type { ResultadoCaso } from "@/core/resultado-caso";

/**
 * Tipos de la feature «motivos de merma y destinos de consumo» (catálogos GLOBALES administrables, plan del 2026-09-23 P5/P6; Hito 4 de la pureza, bloque C de la
 * pieza carta/catálogo/stock, paso H4C-17 — `docs/plan-hito-4-pureza.md` §3): los comandos y resultados de los casos de uso de
 * `src/server/actions/movimientos/casos-de-uso/{crear-motivo-merma,crear-destino-consumo,actualizar-activo-motivo-merma,actualizar-activo-destino-consumo}.ts`,
 * que vienen de las Server Actions de `src/server/actions/movimientos/motivos.ts`. Los dos catálogos tienen la misma forma, así que comparten los tipos.
 */

/** Comando «alta de un motivo de merma o de un destino de consumo»: el nombre YA recortado y validado y la descripción recortada (vacía → `null`). */
export interface ComandoCrearMotivo {
  nombre: string;
  descripcion: string | null;
}

/** El id y el nombre del motivo o destino creado, para el `ResultadoConId` de la Server Action. */
export interface DatosMotivoCreado {
  id: string;
  nombre: string;
}

/** `NOMBRE_REPETIDO`: ya hay uno con ese nombre (sin distinguir mayúsculas): se RECHAZA, no se reusa (nadie lo llama desde un alta rápida). */
export type ResultadoCrearMotivo = ResultadoCaso<DatosMotivoCreado, "NOMBRE_REPETIDO">;

/** Comando «activar o desactivar un motivo de merma o un destino de consumo»: el id y el booleano, que nunca se validaron en la acción. */
export interface ComandoActualizarActivoMotivo {
  id: string;
  activo: boolean;
}

/** `NO_ENCONTRADO`: no hay uno con ese id (la acción no refresca la vista en ese camino). */
export type ResultadoActualizarActivoMotivo = ResultadoCaso<null, "NO_ENCONTRADO">;
