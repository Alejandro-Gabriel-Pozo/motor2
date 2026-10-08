import type { ResultadoCaso } from "@/core/resultado-caso";

/**
 * Tipos de la feature «insumos y grupos» (la pantalla de Insumos y Grupos; Hito 4 de la pureza, bloque 4.3, paso H4C-9 — `docs/plan-hito-4-pureza.md` §3): los
 * comandos y resultados de los seis casos de uso de `src/server/actions/catalogo/casos-de-uso/` que vienen de las Server Actions de
 * `src/server/actions/catalogo/insumos.ts` (insumos y grupos de insumos viven en el mismo archivo). Mismo criterio que `core/features/mesas/mesas.schema.ts`.
 */

/** Comando «crear (o reusar) un insumo»: el nombre YA recortado y validado por `guardComandoCrearInsumo` (no vacío, charset y largo de catálogo). */
export interface ComandoCrearInsumo {
  nombre: string;
}

/** El id y el nombre del insumo creado o reusado, para el `ResultadoConId` de la Server Action (el alta rápida y el asistente de hermanar lo reciben por callback). */
export interface DatosInsumo {
  id: string;
  nombre: string;
}

/** Sin fracasos propios: el formato lo rechaza antes el guard, y un nombre repetido no es un error (se reusa el existente). */
export type ResultadoCrearInsumo = ResultadoCaso<DatosInsumo, never>;

/** Comando «activar o desactivar un insumo»: el id y el booleano, que nunca se validaron en la acción (sin guard: el id lo resuelve la base). */
export interface ComandoActualizarActivoInsumo {
  insumoId: string;
  activo: boolean;
}

/** Comando «cambiar el grupo de un insumo» (`null` = sin grupo): los dos ids, que nunca se validaron en la acción (sin guard: los resuelve la base). */
export interface ComandoActualizarGrupoDeInsumo {
  insumoId: string;
  grupoId: string | null;
}

/**
 * Comando «renombrar un insumo, o fusionarlo con otro si el nombre nuevo ya es de otro»: el nombre YA recortado y validado por
 * `guardComandoRenombrarOFusionarInsumo`; `confirmarFusion` pasa tal cual (llega del navegador: solo un `true` estricto confirma, y lo mira el caso de uso
 * DESPUÉS de leer los dos insumos, como antes).
 */
export interface ComandoRenombrarOFusionarInsumo {
  insumoId: string;
  nombre: string;
  confirmarFusion: boolean;
}

/**
 *  - `INSUMO_NO_ENCONTRADO`: el id no es de un insumo;
 *  - `UNIDAD_MEZCLADA`: la fusión dejaría bajo el mismo insumo productos con distinta unidad de stock (`validarFusionInsumos`);
 *  - `FALTA_CONFIRMAR`: el nombre ya es de otro insumo y no vino la confirmación explícita de la fusión.
 */
export type ResultadoRenombrarOFusionarInsumo = ResultadoCaso<null, "INSUMO_NO_ENCONTRADO" | "UNIDAD_MEZCLADA" | "FALTA_CONFIRMAR">;

/** Comando «crear un grupo, o cambiarle el padre si ya existe uno con ese nombre»: el nombre YA validado por `guardComandoCrearOActualizarGrupo`; el padre tal cual. */
export interface ComandoCrearOActualizarGrupo {
  nombre: string;
  grupoPadreId: string | null;
}

/** `CREARIA_CICLO`: el padre pedido desciende del grupo (o es el mismo grupo). */
export type ResultadoCrearOActualizarGrupo = ResultadoCaso<null, "CREARIA_CICLO">;

/** Comando «activar o desactivar un grupo»: el id y el booleano, que nunca se validaron en la acción (sin guard: el id lo resuelve la base). */
export interface ComandoActualizarActivoGrupo {
  grupoId: string;
  activo: boolean;
}

/**
 * Cambiar el grupo de un insumo. Desde O.44b (antes un id roto hacía lanzar a Prisma): `INSUMO_NO_ENCONTRADO` (el insumo no existe, es de otra empresa o el id
 * no es texto) y `GRUPO_NO_ENCONTRADO` (lo mismo para el grupo pedido, si no es `null`).
 */
export type ResultadoActualizarGrupoDeInsumo = ResultadoCaso<null, "INSUMO_NO_ENCONTRADO" | "GRUPO_NO_ENCONTRADO">;

/** `INSUMO_NO_ENCONTRADO`: no hay un insumo con ese id (o es de otra empresa). Desde O.44; antes un id así hacía lanzar a Prisma. */
export type ResultadoActualizarActivoInsumo = ResultadoCaso<null, "INSUMO_NO_ENCONTRADO">;

/** `GRUPO_NO_ENCONTRADO`: no hay un grupo con ese id (o es de otra empresa). Desde O.44; antes un id así hacía lanzar a Prisma. */
export type ResultadoActualizarActivoGrupo = ResultadoCaso<null, "GRUPO_NO_ENCONTRADO">;
