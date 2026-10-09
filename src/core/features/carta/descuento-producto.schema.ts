import type { ResultadoCaso } from "@/core/resultado-caso";

/**
 * Tipos de la feature «descuento de un producto en la sucursal» (Hito 4 de la pureza, bloque 4.2, paso H4C-1 — `docs/plan-hito-4-pureza.md` §3): el comando y el
 * resultado del caso de uso `guardarDescuentoProductoCasoDeUso` (`src/server/actions/carta/casos-de-uso/guardar-descuento-producto.ts`), que viene de la Server
 * Action `guardarDescuentoProducto` (`src/server/actions/carta/descuento-producto.ts`). Mismo criterio que `core/features/mesas/mesas.schema.ts`.
 */

/**
 * Comando «fijar (o sacar) el % de descuento de un producto en la sucursal activa»: lo que recibe el caso de uso, con el porcentaje YA validado y normalizado por
 * `guardComandoGuardarDescuentoProducto`: un número mayor que 0 y menor que 100, o `null` (vacío o 0 = sacar el descuento).
 */
export interface ComandoGuardarDescuentoProducto {
  productoId: string;
  porcentaje: number | null;
}

/**
 * `huboCambio`: si el caso de uso ESCRIBIÓ la base (alta, cambio —aunque sea al mismo valor— o borrado). Es `false` solo cuando se pide sacar un descuento que el
 * producto no tenía: ese camino no escribe y la Server Action no revalida la carta pública (como antes de la mudanza).
 */
export interface DatosGuardarDescuentoProducto {
  huboCambio: boolean;
}

/**
 * Solo lo que produce el caso de uso (el formato del % lo rechaza antes el guard):
 *  - `PRODUCTO_NO_ENCONTRADO`: el id no es de un producto de la empresa;
 *  - `NO_ES_PV`: el producto es una materia prima (solo un PV tiene descuento);
 *  - `OPCION_DE_ITEM_AGRUPADO`: el producto es opción de un ítem agrupado de la carta en la sucursal (el renglón agrupado muestra un solo precio).
 */
export type ResultadoGuardarDescuentoProducto = ResultadoCaso<DatosGuardarDescuentoProducto, "PRODUCTO_NO_ENCONTRADO" | "NO_ES_PV" | "OPCION_DE_ITEM_AGRUPADO">;
