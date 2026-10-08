import type { ResultadoCaso } from "@/core/resultado-caso";

/**
 * Tipos de la feature «ítems agrupados de la carta» (docs/plan-agrupacion-items-carta-2026-09-24.md, M5; Hito 5, bloque D, `docs/plan-hito-5-pureza.md` §6.1): los
 * comandos y resultados de los casos de uso de `src/server/actions/carta/casos-de-uso/*-item-agrupado-carta.ts` y `*-opcion-item-agrupado-carta.ts`, que vienen de la
 * Server Action `src/server/actions/carta/items-agrupados.ts`. Los ítems agrupados y sus opciones son PROPIOS de cada sucursal (ADR-009, C3): todo actúa sobre la
 * sucursal ACTIVA, con `whereCartaDeSucursal`.
 */

/** Comando «apagar o prender un ítem agrupado»: solo un id y un booleano, que nunca se validaron en la acción (el id lo resuelve el caso de uso). */
export interface ComandoActualizarActivoItemAgrupadoCarta {
  itemAgrupadoCartaId: string;
  activo: boolean;
}

/** `ITEM_NO_ENCONTRADO`: el id no es de un ítem agrupado de esta sucursal (uno de otra sucursal responde igual; la acción no revalida la carta en ese camino). */
export type ResultadoActualizarActivoItemAgrupadoCarta = ResultadoCaso<null, "ITEM_NO_ENCONTRADO">;

/** Comando «cambiar el orden de una opción de un ítem agrupado»: lo que recibe `actualizarOrdenOpcionItemAgrupadoCartaCasoDeUso`, con el orden YA validado por el guard (vacío o null valen 0). */
export interface ComandoActualizarOrdenOpcionItemAgrupadoCarta {
  opcionId: string;
  orden: number;
}

/** `OPCION_NO_ENCONTRADA`: el id no es de una opción de esta sucursal (el orden roto lo rechaza antes el guard, y gana sobre este). */
export type ResultadoActualizarOrdenOpcionItemAgrupadoCarta = ResultadoCaso<null, "OPCION_NO_ENCONTRADA">;

/** Comando «quitar una opción de su ítem agrupado»: solo un id, que nunca se validó en la acción (el id lo resuelve el caso de uso). */
export interface ComandoQuitarOpcionItemAgrupadoCarta {
  opcionId: string;
}

/** `OPCION_NO_ENCONTRADA`: el id no es de una opción de esta sucursal, o ya estaba quitada (la acción no revalida la carta en ese camino). */
export type ResultadoQuitarOpcionItemAgrupadoCarta = ResultadoCaso<null, "OPCION_NO_ENCONTRADA">;
