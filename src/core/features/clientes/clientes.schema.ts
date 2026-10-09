import type { ResultadoDato } from "@/core/datos/resultado";
import type { ResultadoCaso } from "@/core/resultado-caso";

/**
 * Tipos de la feature «clientes con % de descuento» (Hito 4 de la pureza, bloque C de la pieza carta/catálogo/stock, paso H4C-15 — `docs/plan-hito-4-pureza.md`
 * §3): los comandos y resultados de los casos de uso `altaClienteCasoDeUso`, `actualizarClienteCasoDeUso` y `actualizarActivoClienteCasoDeUso`
 * (`src/server/actions/clientes/casos-de-uso/`), que vienen de las Server Actions de `src/server/actions/clientes/cliente.ts`. Mismo criterio que
 * `core/features/catalogo/proveedores.schema.ts`.
 */

/**
 * Comando «alta de un cliente»: el nombre YA recortado y validado y el % ya validado (`guardComandoAltaCliente`). El % es `number | null` porque así lo devuelve
 * `validarPorcentajeDescuento`; con el % obligatorio (el de siempre) nunca llega `null`.
 */
export interface ComandoAltaCliente {
  nombre: string;
  descuentoPorcentaje: number | null;
}

/** El id y el nombre del cliente creado, para el `ResultadoConId` de la Server Action. */
export interface DatosClienteCreado {
  id: string;
  nombre: string;
}

/** `NOMBRE_REPETIDO`: ya hay un cliente con ese nombre (sin distinguir mayúsculas). */
export type ResultadoAltaCliente = ResultadoCaso<DatosClienteCreado, "NOMBRE_REPETIDO">;

/** Los datos de «corregir nombre y % de un cliente» YA validados por `guardComandoActualizarCliente`: el nombre recortado y el % (`number | null`, como lo devuelve `validarPorcentajeDescuento`). */
export interface DatosActualizarCliente {
  nombre: string;
  descuentoPorcentaje: number | null;
}

/**
 * Comando «corregir nombre y % de un cliente»: el id y el RESULTADO del guard (`guardComandoActualizarCliente`, que la acción llama con lo que mandó el cliente). El caso de uso no
 * recibe nunca datos sin validar —ni un `unknown`—, pero aplica el rechazo del guard DESPUÉS de leer el cliente: un cliente inexistente gana sobre un dato inválido (fijado por
 * test/clientes/cliente-mensajes.test.ts), y el nombre inválido gana sobre el %.
 */
export interface ComandoActualizarCliente {
  clienteId: string;
  datos: ResultadoDato<DatosActualizarCliente>;
}

/**
 *  - `NO_ENCONTRADO`: no hay un cliente con ese id;
 *  - `DATO_INVALIDO`: el nombre o el % no son válidos;
 *  - `NOMBRE_REPETIDO`: OTRO cliente ya tiene ese nombre (sin distinguir mayúsculas).
 */
export type ResultadoActualizarCliente = ResultadoCaso<null, "NO_ENCONTRADO" | "DATO_INVALIDO" | "NOMBRE_REPETIDO">;

/** Comando «activar o desactivar un cliente»: el id y el booleano, que nunca se validaron en la acción. */
export interface ComandoActualizarActivoCliente {
  clienteId: string;
  activo: boolean;
}

/** `NO_ENCONTRADO`: no hay un cliente con ese id (la acción no refresca la vista en ese camino). */
export type ResultadoActualizarActivoCliente = ResultadoCaso<null, "NO_ENCONTRADO">;
