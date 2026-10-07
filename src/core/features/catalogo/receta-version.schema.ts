import type { CabeceraRecetaInput, IngredienteInput, PasoInput } from "@/core/catalogo/public";
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
