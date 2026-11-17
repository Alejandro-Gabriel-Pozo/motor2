import type { ModoDeOrdenDeSeccion } from "@/core/carta/public";
import type { ResultadoCaso } from "@/core/resultado-caso";

/**
 * Tipos de la feature «orden de los renglones de una sección de carta» (docs/diseno-carta-orden-permiso-y-precio-de-familia-2026-11-17.md, etapa O1): los comandos y resultados de los casos de uso
 * `src/server/actions/carta/casos-de-uso/{fijar-modo-de-orden-de-seccion,reordenar-renglones-de-seccion}.ts`, que vienen de la Server Action `src/server/actions/carta/orden-de-renglones.ts`.
 * El modo y el orden son de UNA sucursal (la activa del contexto: nunca viaja en el comando). Mismo criterio que `secciones.schema.ts`.
 */

/** Tope de renglones de UNA sección en un pedido de reordenar (lo valida el guard). */
export const MAXIMO_DE_RENGLONES_AL_ORDENAR = 200;

/** Los dos tipos de renglón que comparten la escala de `orden` dentro de una sección. */
export const TIPOS_DE_RENGLON_DE_CARTA = ["PRODUCTO", "ITEM_AGRUPADO"] as const;
export type TipoDeRenglonDeCarta = (typeof TIPOS_DE_RENGLON_DE_CARTA)[number];

/**
 * Comando «fijar el modo de orden de una sección» (CU-O1), por ESTADO deseado. `versionVista` es la versión del modo que vio la pantalla (0 = no había fila: la sección iba a mano por defecto); si otra persona
 * lo cambió antes, se rechaza. `modoId` es el id (uuid) con el que se crearía la fila: lo genera el servidor, así un reintento no puede crear dos.
 */
export interface ComandoFijarModoDeOrdenDeSeccion {
  seccionCartaId: string;
  modo: ModoDeOrdenDeSeccion;
  versionVista: number;
  modoId: string;
}

/**
 *  - `SECCION_NO_ENCONTRADA`: la sección no es de la empresa (o ya no existe);
 *  - `MODO_DESACTUALIZADO`: otra persona cambió el modo mientras se miraba la pantalla: no se cambió nada;
 *  - `SIN_PERMISO`: la sección tiene ítems agrupados y quien pide no puede editarlos (`carta_items_agrupados`): además de `carta_contenido_producto`, que ya pidió la acción.
 * `cambio` es `false` si el modo ya era ese (no se escribió ni se auditó).
 */
export type ResultadoFijarModoDeOrdenDeSeccion = ResultadoCaso<{ cambio: boolean }, "SECCION_NO_ENCONTRADA" | "MODO_DESACTUALIZADO" | "SIN_PERMISO">;

/** Un renglón de la lista pedida: su clave `{tipo, id}` (`id` es el del producto o el del ítem agrupado) y el `orden` que vio la pantalla. */
export interface RenglonPedidoAlOrdenar {
  tipo: TipoDeRenglonDeCarta;
  id: string;
  ordenVisto: number;
}

/** Comando «reordenar los renglones de una sección» (CU-O2): la lista COMPLETA de la sección, en el orden nuevo, sin repetidos, de 1 a `MAXIMO_DE_RENGLONES_AL_ORDENAR`. */
export interface ComandoReordenarRenglonesDeSeccion {
  seccionCartaId: string;
  renglones: RenglonPedidoAlOrdenar[];
}

/**
 *  - `SECCION_NO_ENCONTRADA`: la sección no es de la empresa (o ya no existe);
 *  - `RENGLON_NO_ENCONTRADO`: un renglón pedido no existe en la carta de esta sucursal (también si es de otra sucursal u otra empresa: misma respuesta que no existir);
 *  - `SIN_PERMISO`: la lista incluye ítems agrupados y quien pide no puede editarlos (`carta_items_agrupados`);
 *  - `ORDEN_DESACTUALIZADO`: falta o sobra un renglón (se agregó, se ocultó o se movió uno mientras se ordenaba) o el orden de alguno cambió desde que se cargó la pantalla: no se cambia ninguno.
 */
export type ResultadoReordenarRenglonesDeSeccion = ResultadoCaso<{ cambiados: number }, "SECCION_NO_ENCONTRADA" | "RENGLON_NO_ENCONTRADO" | "ORDEN_DESACTUALIZADO" | "SIN_PERMISO">;
