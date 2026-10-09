import type { CabeceraRecetaInput, IngredienteInput, PasoInput } from "@/core/catalogo/public";
import type { ResultadoDato } from "@/core/datos/resultado";
import type { ResultadoCaso } from "@/core/resultado-caso";

/**
 * Comando «guardar una versión nueva de la receta» (Task #41, P1 — docs/arquitectura-casos-de-uso-2026-09-27.md): lo que recibe el caso
 * de uso `guardarVersionDeRecetaCasoDeUso` (src/server/actions/catalogo/casos-de-uso/guardar-version-de-receta.ts), con el `productoId`
 * ya validado por `guardComandoGuardarVersionDeReceta`. `items`/`pasos`/`cabecera` viajan TAL CUAL llegaron a `guardarReceta`: los
 * validan `validarIngredientes`/`validarPasos`/`validarCabecera` (core/catalogo) en el caso de uso, en el mismo orden de siempre (los
 * tres necesitan el producto ya cargado o leen catálogo, así que no pueden correr en el guard, que es puro).
 *
 * Reemplazo completo: los tres van juntos en la MISMA versión (ver el docstring de `guardarReceta`).
 */
export interface ComandoGuardarVersionDeReceta {
  productoId: string;
  items: IngredienteInput[];
  pasos: PasoInput[];
  cabecera: CabeceraRecetaInput;
  /**
   * La versión de la serie (central o propia) sobre la que quien llama armó este reemplazo (`0` = todavía no había ninguna), o `null` si es un reemplazo completo a ciegas (seeds, scripts: no
   * parte de ninguna lectura previa). Si cuando se guarda la serie ya va por OTRA versión, alguien guardó en el medio y este guardado pisaría su cambio: se rechaza (`VERSION_DESACTUALIZADA`).
   */
  versionEsperada: number | null;
  /**
   * S-52: el rechazo del guard de la PUERTA de la acción puntual (`guardComando…DeReceta`) por un dato del cambio fuera de rango (una cantidad, una merma, los minutos de un paso, un
   * tiempo de la cabecera…), calculado por la acción con lo que mandó el cliente. El caso de uso lo aplica DESPUÉS de leer el producto y de ver que es elegible —un producto
   * inexistente o no elegible gana sobre un dato inválido, como siempre— y antes de cargar el catálogo y de validar el resto. Ausente en el guardado completo (`guardarReceta`), que
   * valida todo con `validarIngredientes`/`validarPasos`/`validarCabecera` en su lugar de siempre.
   */
  puerta?: RechazoDeLaPuertaDeReceta | null;
}

/** El rechazo de la puerta, con la etapa a la que pertenece el dato (es el código con el que vuelve del caso de uso). */
export interface RechazoDeLaPuertaDeReceta {
  codigo: "INGREDIENTES_INVALIDOS" | "PASOS_INVALIDOS" | "CABECERA_INVALIDA";
  mensaje: string;
}

/**
 * El resultado del guard de una acción puntual de receta (S-52), POR ETAPA, porque cada una se aplica en un lugar distinto:
 *  - `forma`: el dato tiene la forma que la propia acción necesita para seguir (antes, uno que no la tenía reventaba con un error crudo): la acción lo devuelve en el acto;
 *  - `inmediata`: el producto es texto y la versión que vio la pantalla es una versión posible: se devuelve dentro del permiso y antes del caso de uso, igual que antes
 *    (`guardComandoGuardarVersionDeReceta`);
 *  - `rango`: el dato del cambio está en rango: se aplica en el caso de uso, después de leer el producto (ver `puerta` arriba).
 */
export interface PuertaDeReceta {
  forma: ResultadoDato<null>;
  inmediata: ResultadoDato<null>;
  rango: ResultadoDato<null>;
}

export type CodigoGuardarVersionDeReceta =
  | "PRODUCTO_NO_ENCONTRADO"
  | "PRODUCTO_NO_ELEGIBLE"
  | "INGREDIENTES_INVALIDOS"
  | "PASOS_INVALIDOS"
  | "CABECERA_INVALIDA"
  | "VERSION_DESACTUALIZADA";

/**
 * `datos` de un guardado exitoso. `calibracionesDescartadas`: una entrada por calibración local (`RendimientoLocalIngrediente`) que NO
 * se arrastró a la versión nueva (el ingrediente cambió de unidad o salió de la receta) — el mismo texto que arma el aviso del mensaje.
 */
export interface DatosGuardarVersionDeReceta {
  recetaVersionId: string;
  version: number;
  calibracionesDescartadas: string[];
}

export type ResultadoGuardarVersionDeReceta = ResultadoCaso<DatosGuardarVersionDeReceta, CodigoGuardarVersionDeReceta>;
