import type { ResultadoCaso } from "@/core/resultado-caso";

/**
 * Tipos de la feature «precio local de un producto en la sucursal» (Hito 4 de la pureza, bloque 4.2, paso H4C-4 — `docs/plan-hito-4-pureza.md` §3): los comandos y
 * resultados de los casos de uso de `src/server/actions/movimientos/casos-de-uso/` que vienen de la Server Action `src/server/actions/movimientos/precio-local.ts`
 * (`setPrecioLocalProducto` y `sincronizarPrecioLocalGrupoCarta`). Mismo criterio que `core/features/mesas/mesas.schema.ts`.
 */

/**
 * Comando «fijar el precio local de un producto en la sucursal activa»: lo que recibe `setPrecioLocalProductoCasoDeUso`, con el precio YA validado por
 * `guardComandoSetPrecioLocalProducto` (un importe no negativo, con a lo sumo 2 decimales, dentro del tope: el mismo validador que el formulario).
 */
export interface ComandoSetPrecioLocalProducto {
  productoId: string;
  precio: number;
  habilitado: boolean;
}

/** `PRODUCTO_NO_ENCONTRADO`: el id no es de un producto de la empresa (el formato del precio lo rechaza antes el guard). */
export type ResultadoSetPrecioLocalProducto = ResultadoCaso<null, "PRODUCTO_NO_ENCONTRADO">;

/**
 * Comando «aplicar el mismo precio local a los productos de UN ítem agrupado de la carta»: lo que recibe `sincronizarPrecioLocalGrupoCartaCasoDeUso`, YA
 * validado por `guardComandoSincronizarPrecioLocalGrupoCarta`: la sucursal que vio la pantalla es la activa, el precio es un importe válido y la lista de ids,
 * sin repetidos, no está vacía.
 */
export interface ComandoSincronizarPrecioLocalGrupoCarta {
  productoIds: string[];
  precio: number;
  habilitado: boolean;
}

/** `NO_SON_DEL_MISMO_ITEM`: los productos no son todos opciones del mismo ítem agrupado de la carta en la sucursal activa. */
export type ResultadoSincronizarPrecioLocalGrupoCarta = ResultadoCaso<null, "NO_SON_DEL_MISMO_ITEM">;
