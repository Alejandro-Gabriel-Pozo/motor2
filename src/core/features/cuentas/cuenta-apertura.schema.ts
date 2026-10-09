import type { ResultadoCaso } from "@/core/resultado-caso";

/**
 * Tipos de la APERTURA de la cuenta de una mesa (feature Cuenta del salón, módulo POS; Hito 4 de la pureza, bloque 4.1 — `docs/plan-hito-4-pureza.md` §5):
 * comandos y resultados de los casos de uso de `src/server/actions/pos/casos-de-uso/` que vienen de `src/server/actions/pos/cuenta-apertura.ts` (abrir la
 * cuenta, corregir sus comensales, asignarle un cliente y liberar la mesa sin venta). Archivo aparte de `cuenta.schema.ts` (cierre y ticket) y de
 * `cuenta-anulacion.schema.ts` por el mismo corte que ya tienen las Server Actions.
 *
 * Los comandos traen el id YA validado por su guard (solo que sea un texto: si no, «no encontrado», el mismo mensaje que antes); el resto viaja CRUDO
 * (`unknown`), porque lo valida el caso de uso en el MISMO lugar que antes (después de encontrar la cuenta), y así cada combinación inválida sigue respondiendo
 * el mismo mensaje.
 */

/** Comando «abrir la cuenta de una mesa»: `comensales` CRUDO, lo valida el caso de uso DESPUÉS de mirar si la mesa ya tenía su cuenta abierta (como antes). */
export interface ComandoAbrirCuenta {
  mesaId: string;
  comensales: unknown;
}

/**
 * Solo lo que produce el caso de uso (un `mesaId` que no es un texto lo rechaza antes el guard). Reabrir una mesa que ya tenía su cuenta abierta NO es un
 * fracaso: responde ok sin tocar nada (por estado, o por el choque del índice único parcial si otro mozo la abrió un instante antes).
 *  - `MESA_NO_ENCONTRADA`: no hay mesa con ese id en esta sucursal;
 *  - `COMENSALES_INVALIDOS`: no es un entero entre 1 y 99 (`validarComensales`);
 *  - `LIMITE_DE_MESAS`: la sucursal ya tiene `maxMesasAbiertas` cuentas abiertas.
 */
export type ResultadoAbrirCuenta = ResultadoCaso<null, "MESA_NO_ENCONTRADA" | "COMENSALES_INVALIDOS" | "LIMITE_DE_MESAS">;

/** Comando «liberar la mesa sin venta»: lo que recibe `liberarMesaCasoDeUso`. */
export interface ComandoLiberarMesa {
  cuentaId: string;
}

/**
 * Solo lo que produce el caso de uso (un `cuentaId` que no es un texto lo rechaza antes el guard):
 *  - `CUENTA_NO_ABIERTA`: no es una cuenta de una mesa de esta sucursal, o ya está cerrada (`cuentaAbiertaDeSucursal`, con su mensaje);
 *  - `CON_ITEMS`: la cuenta tiene alguna fila (aunque esté anulada): se cierra con «Cerrar la cuenta», no se libera.
 */
export type ResultadoLiberarMesa = ResultadoCaso<null, "CUENTA_NO_ABIERTA" | "CON_ITEMS">;

/** Comando «corregir los comensales de una cuenta abierta»: `comensales` CRUDO, lo valida el caso de uso DESPUÉS de encontrar la cuenta (como antes). */
export interface ComandoCorregirComensales {
  cuentaId: string;
  comensales: unknown;
}

/**
 * - `CUENTA_NO_ABIERTA`: no es una cuenta de una mesa de esta sucursal, o ya está cerrada (gana sobre un valor inválido de comensales);
 * - `COMENSALES_INVALIDOS`: no es un entero entre 1 y 99 (`validarComensales`).
 */
export type ResultadoCorregirComensales = ResultadoCaso<null, "CUENTA_NO_ABIERTA" | "COMENSALES_INVALIDOS">;

/**
 * Comando «asignar (o quitar, con `null`) el cliente con descuento de una cuenta abierta»: `clienteId` CRUDO, como llegó (`null` quita; un texto se busca; otra
 * cosa responde «No se encontró ese cliente.», como antes).
 */
export interface ComandoAsignarClienteACuenta {
  cuentaId: string;
  clienteId: unknown;
}

/**
 * - `CUENTA_NO_ABIERTA`: no es una cuenta de una mesa de esta sucursal, o ya está cerrada (gana sobre un cliente inexistente);
 * - `CLIENTE_NO_ENCONTRADO`: no hay cliente con ese id (o el id no es un texto);
 * - `CLIENTE_DESACTIVADO`: el cliente existe pero está desactivado (quitarlo de una cuenta que ya lo tenía sí se puede).
 */
export type ResultadoAsignarClienteACuenta = ResultadoCaso<null, "CUENTA_NO_ABIERTA" | "CLIENTE_NO_ENCONTRADO" | "CLIENTE_DESACTIVADO">;
