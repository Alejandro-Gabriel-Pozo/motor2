import type { ResultadoCaso } from "@/core/resultado-caso";

/**
 * Tipos de la feature «secciones de stock de una sucursal» (port de HOJA_SECCIONES; Hito 4 de la pureza, bloque C de la pieza carta/catálogo/stock, paso H4C-18 —
 * `docs/plan-hito-4-pureza.md` §3): los comandos y resultados de los casos de uso de
 * `src/server/actions/movimientos/casos-de-uso/{crear-seccion,renombrar-seccion,actualizar-activa-seccion,actualizar-respaldo-seccion}.ts`, que vienen de las
 * Server Actions de `src/server/actions/movimientos/secciones.ts`. Todas actúan sobre la sucursal ACTIVA (`conPermiso("secciones")`).
 */

/** Comando «alta de una sección»: el nombre YA recortado y validado (`guardComandoCrearSeccion`). */
export interface ComandoCrearSeccion {
  nombre: string;
}

/** El id y el nombre de la sección creada, para el `ResultadoConId` de la Server Action. */
export interface DatosSeccionCreada {
  id: string;
  nombre: string;
}

/** `NOMBRE_REPETIDO`: ya hay una sección con ese nombre en esta sucursal (sin distinguir mayúsculas). */
export type ResultadoCrearSeccion = ResultadoCaso<DatosSeccionCreada, "NOMBRE_REPETIDO">;

/** Comando «renombrar una sección»: el id (sin validar: lo resuelve la base) y el nombre nuevo YA recortado y validado (`guardComandoRenombrarSeccion`). */
export interface ComandoRenombrarSeccion {
  seccionId: string;
  nombre: string;
}

/**
 *  - `NO_ENCONTRADA`: no hay una sección con ese id en esta sucursal;
 *  - `NOMBRE_REPETIDO`: OTRA sección de esta sucursal ya tiene ese nombre (sin distinguir mayúsculas).
 */
export type ResultadoRenombrarSeccion = ResultadoCaso<null, "NO_ENCONTRADA" | "NOMBRE_REPETIDO">;

/** Comando «activar o desactivar una sección»: el id y el booleano, que nunca se validaron en la acción. */
export interface ComandoActualizarActivaSeccion {
  seccionId: string;
  activa: boolean;
}

/** `NO_ENCONTRADA`: no hay una sección con ese id en esta sucursal (la acción no refresca la vista en ese camino). */
export type ResultadoActualizarActivaSeccion = ResultadoCaso<null, "NO_ENCONTRADA">;

/** Comando «¿sirve de respaldo automático en ventas?»: el id YA visto como texto y el booleano YA visto como booleano (`guardComandoActualizarRespaldoSeccion`). */
export interface ComandoActualizarRespaldoSeccion {
  seccionId: string;
  sirveDeRespaldoEnVentas: boolean;
}

/** `NO_ENCONTRADA`: no hay una sección con ese id en esta sucursal. */
export type ResultadoActualizarRespaldoSeccion = ResultadoCaso<null, "NO_ENCONTRADA">;
