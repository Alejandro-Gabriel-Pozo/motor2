import type { ResultadoCaso } from "@/core/resultado-caso";

/**
 * Tipos de la feature «unidades de medida» (Hito 4 de la pureza, bloque 4.3, paso H4C-8 — `docs/plan-hito-4-pureza.md` §3): los comandos y resultados de los casos
 * de uso `crearUnidadCasoDeUso`, `actualizarActivaUnidadCasoDeUso` y `actualizarDecimalesUnidadCasoDeUso` (`src/server/actions/catalogo/casos-de-uso/`), que vienen
 * de las Server Actions de `src/server/actions/catalogo/unidades.ts`. Mismo criterio que `core/features/mesas/mesas.schema.ts`.
 */

/**
 * La magnitud de una unidad: los valores del enum `MagnitudUnidad` de prisma/schema.prisma, escritos acá porque el núcleo nace sin tipos de Prisma
 * (`pureza-del-nucleo`; mismo criterio que `core/features/empresa/siembra-de-empresa.ts`). La Server Action le pasa el enum de Prisma (asignable) y la persistencia
 * lo recibe de vuelta como ese enum.
 */
export type MagnitudUnidad = "CANTIDAD" | "PESO" | "VOLUMEN";

/**
 * Comando «crear una unidad»: el nombre YA recortado y validado y los decimales YA resueltos (los pedidos o, si no vinieron, los de su magnitud) y validados por
 * `guardComandoCrearUnidad` (un entero entre 0 y 6). La magnitud pasa tal cual, como antes.
 */
export interface ComandoCrearUnidad {
  nombre: string;
  magnitud: MagnitudUnidad;
  decimales: number;
}

/** El id y el nombre de la unidad creada, para el `ResultadoConId` de la Server Action. */
export interface DatosUnidadCreada {
  id: string;
  nombre: string;
}

/** `YA_EXISTE`: ya hay una unidad con ese nombre (sin distinguir mayúsculas). */
export type ResultadoCrearUnidad = ResultadoCaso<DatosUnidadCreada, "YA_EXISTE">;

/** Comando «activar o desactivar una unidad»: el id y el booleano, que nunca se validaron en la acción (sin guard: el id lo resuelve la base). */
export interface ComandoActualizarActivaUnidad {
  unidadId: string;
  activa: boolean;
}

/** Sin fracasos propios: un id que no existe hace lanzar a Prisma (como antes de la mudanza; lo fija `catalogo-sin-test-unitario`). */
export type ResultadoActualizarActivaUnidad = ResultadoCaso<null, never>;

/** Comando «cambiar los decimales de una unidad»: los decimales YA validados por `guardComandoActualizarDecimalesUnidad` (un entero entre 0 y 6). */
export interface ComandoActualizarDecimalesUnidad {
  unidadId: string;
  decimales: number;
}

/**
 *  - `PASO_DE_VENTA_INCOMPATIBLE`: bajar a esos decimales dejaría a un producto «Se produce» con un paso de venta que ya no entra (R3, transición peligrosa (b));
 *  - `UNIDAD_NO_ENCONTRADA`: el id no es de una unidad.
 */
export type ResultadoActualizarDecimalesUnidad = ResultadoCaso<null, "PASO_DE_VENTA_INCOMPATIBLE" | "UNIDAD_NO_ENCONTRADA">;
