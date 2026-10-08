import type { ResultadoCaso } from "@/core/resultado-caso";

/**
 * Tipos de la feature «categorías de producto» (Hito 4 de la pureza, bloque 4.3, paso H4C-7 — `docs/plan-hito-4-pureza.md` §3): los comandos y resultados de los
 * casos de uso `crearCategoriaProductoCasoDeUso` y `actualizarActivaCategoriaProductoCasoDeUso` (`src/server/actions/catalogo/casos-de-uso/`), que vienen de las
 * Server Actions de `src/server/actions/catalogo/categorias-producto.ts`. Mismo criterio que `core/features/mesas/mesas.schema.ts`.
 */

/** Comando «crear (o reusar) una categoría»: el nombre YA recortado y validado por `guardComandoCrearCategoriaProducto` (no vacío, charset y largo de catálogo). */
export interface ComandoCrearCategoriaProducto {
  nombre: string;
}

/**
 * Lo que la Server Action necesita para su `ResultadoConId` (el alta rápida inline del formulario de producto recibe la categoría por callback): el id y el nombre
 * de la categoría creada o, si ya existía una con ese nombre (sin distinguir mayúsculas), de la existente que se reusa.
 */
export interface DatosCategoriaProducto {
  id: string;
  nombre: string;
}

/** Sin fracasos propios: el formato lo rechaza antes el guard, y un nombre repetido no es un error (se reusa la existente). */
export type ResultadoCrearCategoriaProducto = ResultadoCaso<DatosCategoriaProducto, never>;

/** Comando «activar o desactivar una categoría»: el id y el booleano, que nunca se validaron en la acción (sin guard: el id lo resuelve la base). */
export interface ComandoActualizarActivaCategoriaProducto {
  categoriaId: string;
  activo: boolean;
}

/** `CATEGORIA_NO_ENCONTRADA`: no hay una categoría con ese id (o es de otra empresa). Desde O.44; antes un id así hacía lanzar a Prisma. */
export type ResultadoActualizarActivaCategoriaProducto = ResultadoCaso<null, "CATEGORIA_NO_ENCONTRADA">;
