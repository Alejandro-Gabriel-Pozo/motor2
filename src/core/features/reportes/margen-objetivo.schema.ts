import type { ResultadoCaso } from "@/core/resultado-caso";

/**
 * Tipos de la feature «food cost objetivo» (Hito 4 de la pureza, bloque C de la pieza carta/catálogo/stock, paso H4C-16 — `docs/plan-hito-4-pureza.md` §3): el
 * comando y el resultado del caso de uso `guardarMargenObjetivoCasoDeUso` (`src/server/actions/reportes/casos-de-uso/guardar-margen-objetivo.ts`), que viene de
 * la Server Action `guardarMargenObjetivo` (`src/server/actions/reportes/margen-objetivo.ts`).
 */

/**
 * Comando «fijar, cambiar o borrar el food cost objetivo»: `categoriaId` `null` es «toda la empresa» (si no, un id ya validado como texto no vacío) y `valor` el
 * porcentaje ya validado (`validarFoodCostObjetivo`), o `null` para borrar el objetivo propio (vuelve al que corresponde por defecto).
 */
export interface ComandoGuardarMargenObjetivo {
  categoriaId: string | null;
  valor: number | null;
}

/**
 * `huboCambio`: si se escribió algo. Con el mismo valor que ya había (o borrar lo que no estaba) responde ok SIN escribir, sin auditar y SIN refrescar la vista
 * (la Server Action solo refresca con `huboCambio`, como antes).
 */
export interface DatosGuardarMargenObjetivo {
  huboCambio: boolean;
}

/** `CATEGORIA_NO_ENCONTRADA`: la categoría pedida no existe. */
export type ResultadoGuardarMargenObjetivo = ResultadoCaso<DatosGuardarMargenObjetivo, "CATEGORIA_NO_ENCONTRADA">;
