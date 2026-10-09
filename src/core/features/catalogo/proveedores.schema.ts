import type { ResultadoCaso } from "@/core/resultado-caso";

/**
 * Tipos de la feature «proveedores» (Hito 4 de la pureza, bloque C de la pieza carta/catálogo/stock, paso H4C-14 — `docs/plan-hito-4-pureza.md` §3): los comandos y
 * resultados de los casos de uso `altaProveedorCasoDeUso`, `actualizarActivaProveedorCasoDeUso` y `actualizarProveedorCasoDeUso`
 * (`src/server/actions/catalogo/casos-de-uso/`), que vienen de las Server Actions de `src/server/actions/catalogo/proveedores.ts`. Mismo criterio que
 * `core/features/catalogo/productos.schema.ts`.
 */

/**
 * Los datos de contacto de un proveedor tal como llegan del formulario (los MISMOS campos que `DatosProveedor` de la Server Action, menos el nombre), escritos acá
 * porque el núcleo no importa de `server/`. SIN validar: los valida `validarContactoDeProveedor` (`contacto-de-proveedor.ts`).
 */
export interface EntradaContactoDeProveedor {
  contacto?: string;
  telefono?: string;
  email?: string;
  cuit?: string;
  condicionesPago?: string;
  notas?: string;
}

/** Los datos de contacto YA validados: recortados, vacío → `null`, el CUIT canónico (11 dígitos). Es lo que se guarda, columna por columna. */
export interface ValoresDeContactoDeProveedor {
  contacto: string | null;
  telefono: string | null;
  email: string | null;
  cuit: string | null;
  condicionesPago: string | null;
  notas: string | null;
}

/** Comando «alta de un proveedor»: el nombre YA recortado y validado y los datos de contacto ya validados (`guardComandoAltaProveedor`). */
export interface ComandoAltaProveedor {
  nombre: string;
  valores: ValoresDeContactoDeProveedor;
}

/** El id y el nombre del proveedor creado, para el `ResultadoConId` de la Server Action (el alta inline del formulario de producto lo recibe por callback). */
export interface DatosProveedorCreado {
  id: string;
  nombre: string;
}

/**
 *  - `NOMBRE_REPETIDO`: ya hay un proveedor con ese nombre (sin distinguir mayúsculas);
 *  - `CUIT_REPETIDO`: otro proveedor de la empresa ya tiene ese CUIT (antes de crear, o porque una carrera lo frenó en el índice único);
 *  - `CODIGO_REPETIDO`: el índice único saltó y no fue por el CUIT (el código autogenerado, agotados los reintentos).
 */
export type ResultadoAltaProveedor = ResultadoCaso<DatosProveedorCreado, "NOMBRE_REPETIDO" | "CUIT_REPETIDO" | "CODIGO_REPETIDO">;

/** Comando «activar o desactivar un proveedor»: el id y el booleano, que nunca se validaron en la acción (sin guard: el id lo resuelve la base). */
export interface ComandoActualizarActivaProveedor {
  proveedorId: string;
  activo: boolean;
}

/** `NO_ENCONTRADO` (el mismo código que la edición): no hay un proveedor con ese id (o es de otra empresa). Desde O.44; antes un id así hacía lanzar a Prisma. */
export type ResultadoActualizarActivaProveedor = ResultadoCaso<null, "NO_ENCONTRADO">;

/**
 * Comando «corregir los datos de contacto de un proveedor»: el id y los datos SIN validar (sin guard: la acción leía el proveedor ANTES de validar, así que un
 * proveedor inexistente gana sobre un dato inválido).
 */
export interface ComandoActualizarProveedor {
  proveedorId: string;
  datos: EntradaContactoDeProveedor;
}

/**
 *  - `NO_ENCONTRADO`: no hay un proveedor con ese id;
 *  - `DATO_INVALIDO`: algún dato de contacto no es válido (largo, formato del email, CUIT);
 *  - `CUIT_REPETIDO`: otro proveedor de la empresa ya tiene ese CUIT;
 *  - `CHOQUE_DE_UNICIDAD`: el índice único saltó y no fue por el CUIT.
 */
export type ResultadoActualizarProveedor = ResultadoCaso<null, "NO_ENCONTRADO" | "DATO_INVALIDO" | "CUIT_REPETIDO" | "CHOQUE_DE_UNICIDAD">;
