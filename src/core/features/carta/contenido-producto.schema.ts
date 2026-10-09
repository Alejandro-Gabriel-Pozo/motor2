import type { ResultadoDato } from "@/core/datos/resultado";
import type { ResultadoCaso } from "@/core/resultado-caso";

/**
 * Tipos de la feature «contenido de carta de un producto» (docs/plan-carta-catalogo-2026-09-24.md, M9; Hito 5, bloque D, `docs/plan-hito-5-pureza.md` §6.1): los
 * comandos y resultados de los casos de uso de `src/server/actions/carta/casos-de-uso/{guardar-contenido-carta-producto,actualizar-visible-en-carta}.ts`, que
 * vienen de la Server Action `src/server/actions/carta/contenido-producto.ts`. La carta es PROPIA de cada sucursal (ADR-009, C3): todo escribe en la sucursal ACTIVA.
 * Sin fila = no se muestra (D3): guardar el contenido de un PV es lo que lo hace aparecer.
 */

/** DA2: visible exige sección; sin ella el producto no puede salir en la carta (lo usan los dos casos de uso, con el mismo texto de siempre). */
export const MENSAJE_FALTA_SECCION_DE_CARTA = "Elegí la sección de carta donde se muestra (sin sección no puede salir en la carta).";

/** Los datos del contenido tal como llegan del formulario del admin, SIN validar (los mismos campos que `DatosContenidoCarta` de la Server Action). */
export interface EntradaContenidoCartaProducto {
  visibleEnCarta: boolean;
  /** Obligatoria si `visibleEnCarta` (DA2); vacío/null = sin sección (solo para un contenido oculto). */
  seccionCartaId?: string | null;
  descripcion?: string | null;
  /** Lista, o texto separado por comas. */
  tags?: readonly string[] | string | null;
  especial?: boolean;
  orden?: number | string | null;
  /** Carpeta de género del POS, OPCIONAL: vacío/null = sin género (sale suelto). */
  generoCartaId?: string | null;
}

/** Lo que `guardComandoGuardarContenidoCartaProducto` valida y normaliza del contenido: la descripción (recortada, `null` si queda vacía), los tags y el orden. */
export interface ContenidoCartaValidado {
  descripcion: string | null;
  tags: string[];
  orden: number;
}

/**
 * Comando «guardar el contenido de carta de un producto»: lo que recibe `guardarContenidoCartaProductoCasoDeUso`. Los `validados` son el RESULTADO de
 * `guardComandoGuardarContenidoCartaProducto` (S-52), que la acción calcula con lo que mandó el cliente; el caso de uso aplica su rechazo DESPUÉS de leer el producto (un
 * producto inexistente gana sobre una descripción larga: fijado por tests), nunca antes. El resto de `datos` (visible, sección, género, especial) lo resuelve el caso de uso.
 */
export interface ComandoGuardarContenidoCartaProducto {
  productoId: string;
  datos: EntradaContenidoCartaProducto;
  validados: ResultadoDato<ContenidoCartaValidado>;
}

/**
 *  - `PRODUCTO_NO_ENCONTRADO`: el producto no existe;
 *  - `NO_ES_PV`: solo un producto de venta (PV) puede ir en la carta;
 *  - `DATO_INVALIDO`: la descripción, los tags o el orden no son válidos (el texto es el del validador);
 *  - `FALTA_SECCION`: visible sin sección de carta (DA2);
 *  - `SECCION_NO_ENCONTRADA`: la sección elegida no existe (gana sobre el género);
 *  - `GENERO_INVALIDO`: el género no existe en esta sucursal o está apagado.
 */
export type ResultadoGuardarContenidoCartaProducto = ResultadoCaso<null, "PRODUCTO_NO_ENCONTRADO" | "NO_ES_PV" | "DATO_INVALIDO" | "FALTA_SECCION" | "SECCION_NO_ENCONTRADA" | "GENERO_INVALIDO">;

/** Comando «mostrar u ocultar un producto en la carta» (el atajo): solo un id y un booleano, que nunca se validaron en la acción (sin guard). */
export interface ComandoActualizarVisibleEnCarta {
  productoId: string;
  visibleEnCarta: boolean;
}

/**
 *  - `PRODUCTO_NO_ENCONTRADO` / `NO_ES_PV`: como arriba;
 *  - `FALTA_SECCION`: mostrar un producto cuyo contenido (EN ESTA sucursal) todavía no tiene sección.
 */
export type ResultadoActualizarVisibleEnCarta = ResultadoCaso<null, "PRODUCTO_NO_ENCONTRADO" | "NO_ES_PV" | "FALTA_SECCION">;
