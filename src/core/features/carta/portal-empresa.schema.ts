import type { ValoresPortal } from "@/core/carta/public";
import type { ResultadoCaso } from "@/core/resultado-caso";

/**
 * Tipos de la feature «portal de la empresa» (ADR-006; Hito 5, bloque D, `docs/plan-hito-5-pureza.md` §6.1): el comando y el resultado del caso de uso
 * `src/server/actions/carta/casos-de-uso/guardar-portal-empresa.ts`, que viene de la Server Action `src/server/actions/carta/portal-empresa.ts`. El portal es de la
 * EMPRESA (una fila por empresa, `empresaId` único).
 */

/** Comando «guardar la apariencia del portal»: lo que recibe `guardarPortalEmpresaCasoDeUso`, con los valores YA validados y normalizados por `guardComandoGuardarPortalEmpresa`. */
export interface ComandoGuardarPortalEmpresa {
  valores: ValoresPortal;
}

/** Solo la cuenta de valores cargados (el texto del éxito la nombra). No hay fracasos propios: el formato lo rechaza antes el guard y el `upsert` no tiene ramas. */
export type ResultadoGuardarPortalEmpresa = ResultadoCaso<{ cantidad: number }, never>;
