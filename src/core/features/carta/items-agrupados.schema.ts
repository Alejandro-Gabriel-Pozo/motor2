import type { ResultadoCaso } from "@/core/resultado-caso";

/**
 * Tipos de la feature «ítems agrupados de la carta» (docs/plan-agrupacion-items-carta-2026-09-24.md, M5; Hito 5, bloque D, `docs/plan-hito-5-pureza.md` §6.1): los
 * comandos y resultados de los casos de uso de `src/server/actions/carta/casos-de-uso/*-item-agrupado-carta.ts` y `*-opcion-item-agrupado-carta.ts`, que vienen de la
 * Server Action `src/server/actions/carta/items-agrupados.ts`. Los ítems agrupados y sus opciones son PROPIOS de cada sucursal (ADR-009, C3): todo actúa sobre la
 * sucursal ACTIVA, con `whereCartaDeSucursal`.
 */

/**
 * Comando «alta o edición de un ítem agrupado» (sin `id` = alta; con `id` = edición): lo que recibe `guardarItemAgrupadoCartaCasoDeUso`, con los textos y el orden
 * YA validados por `guardComandoGuardarItemAgrupadoCarta` (nombre recortado y válido, descripción en largo o `null`, tags normalizados, orden entero, tope de productos
 * y sección elegida). El `generoCartaId` y los `productoIds` pasan CRUDOS (el caso de uso los resuelve contra la base, en el mismo lugar que antes).
 */
export interface ComandoGuardarItemAgrupadoCarta {
  id?: string;
  nombre: string;
  seccionCartaId: string;
  descripcion: string | null;
  tags: string[];
  especial: boolean;
  orden: number;
  /** Carpeta de género del POS, OPCIONAL: vacío o en blanco = sin género. Las opciones del ítem heredan este género. */
  generoCartaId?: string | null;
  /** SOLO en el alta (DA7): productos a agregar como opciones apenas se crea el ítem, en este orden; al editar se ignora. */
  productoIds: readonly string[];
}

/** El id y el nombre del ítem guardado (creado o editado), para el `ResultadoConId` de la Server Action. */
export interface DatosItemAgrupadoCartaGuardado {
  id: string;
  nombre: string;
}

/**
 * Solo lo que produce el caso de uso (el formato lo rechaza antes el guard):
 *  - `SECCION_NO_ENCONTRADA`: la sección elegida no existe (gana sobre el género);
 *  - `GENERO_INVALIDO`: el género no existe en esta sucursal o está apagado (gana sobre el nombre repetido);
 *  - `NOMBRE_REPETIDO`: OTRO ítem de esta sucursal ya tiene ese nombre (sin distinguir mayúsculas), también si lo ganó otro pedido a la vez (la carrera del índice único);
 *    gana sobre `ITEM_NO_ENCONTRADO`;
 *  - `ITEM_NO_ENCONTRADO`: el ítem a editar no existe en esta sucursal (uno de otra sucursal responde igual).
 * Un producto de `productoIds` que no entra NO es un fracaso: el alta sale bien y el mensaje dice cuáles no entraron y por qué (DA7).
 */
export type ResultadoGuardarItemAgrupadoCarta = ResultadoCaso<DatosItemAgrupadoCartaGuardado, "SECCION_NO_ENCONTRADA" | "GENERO_INVALIDO" | "NOMBRE_REPETIDO" | "ITEM_NO_ENCONTRADO">;

/**
 * Los avisos que el caso de uso le da a quien lo llama (la Server Action) CUANDO la carta pública cambia: un caso de uso no puede importar Next (`casos-de-uso-no-cookies`)
 * y el alta con productos invalida la carta una vez por el ítem y otra por cada producto que entra, así que no alcanza con revalidar al final. La acción lo llena con
 * `revalidarCartasPublicas`.
 */
export interface AvisosDeItemAgrupado {
  cartaCambio(): void;
}

/**
 * Comando «agregar un producto como opción de un ítem agrupado»: lo que recibe `agregarOpcionItemAgrupadoCartaCasoDeUso`, CRUDO. No hay guard (`SIN_GUARD` en
 * `acciones-migradas-con-guard.test.ts`): el ítem se lee ANTES de mirar el producto y el orden se valida después de varias lecturas (un ítem inexistente gana sobre
 * «elegí el producto»; un producto ya agrupado, sobre un orden roto), así que la validación vive en el caso de uso, en el mismo orden que antes.
 */
export interface ComandoAgregarOpcionItemAgrupadoCarta {
  itemAgrupadoCartaId: string;
  productoId: string;
  /** `null` = al final (la cantidad de opciones que ya tiene el ítem); vacío vale 0. */
  orden: number | string | null;
}

/**
 *  - `ITEM_NO_ENCONTRADO`: el ítem no existe en esta sucursal (gana sobre todo lo del producto);
 *  - `FALTA_PRODUCTO`: no se eligió producto;
 *  - `PRODUCTO_NO_ENCONTRADO` / `NO_ES_PV`: el producto no existe, o no es un producto de venta (solo un PV puede ir en la carta);
 *  - `CON_DESCUENTO`: el producto tiene descuento en ALGUNA sucursal (el renglón agrupado muestra un solo precio);
 *  - `YA_AGRUPADO`: el producto ya está en un ítem agrupado de esta sucursal, el mismo u otro (D2), también si lo ganó otro pedido a la vez (la carrera del índice único);
 *  - `ORDEN_INVALIDO`: el orden no es un entero;
 *  - `PRECIO_DISTINTO`: el precio del producto en la sucursal activa (`precioDeCarta`) no coincide con el de todas las opciones del ítem (D5).
 */
export type ResultadoAgregarOpcionItemAgrupadoCarta = ResultadoCaso<
  null,
  "ITEM_NO_ENCONTRADO" | "FALTA_PRODUCTO" | "PRODUCTO_NO_ENCONTRADO" | "NO_ES_PV" | "CON_DESCUENTO" | "YA_AGRUPADO" | "ORDEN_INVALIDO" | "PRECIO_DISTINTO"
>;

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
