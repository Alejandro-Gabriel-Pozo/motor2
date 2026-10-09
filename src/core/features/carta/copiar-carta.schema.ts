import type { ResultadoCaso } from "@/core/resultado-caso";

/**
 * Tipos de la feature «copiar la carta de otra sucursal» (ADR-009, C3/C4; decisión del dueño 2026-10-02; Hito 5, bloque D, `docs/plan-hito-5-pureza.md` §6.1): el
 * comando y el resultado del caso de uso `src/server/actions/carta/casos-de-uso/copiar-carta-de-sucursal.ts`, que viene de la Server Action
 * `src/server/actions/carta/copiar-carta.ts`. El destino es SIEMPRE la sucursal activa (nunca llega por parámetro).
 */

/** Comando «copiar la carta propia de OTRA sucursal a la activa»: el origen, ya confirmado y distinto de la sucursal activa por `guardComandoCopiarCartaDeSucursal`. */
export interface ComandoCopiarCartaDeSucursal {
  sucursalOrigenId: string;
}

/** Cuánto se copió (el texto del éxito y la fila de auditoría lo nombran); la acción no lo expone. */
export interface DatosCartaCopiada {
  productos: number;
  itemsAgrupados: number;
  generos: number;
}

/**
 * Solo lo que produce el caso de uso (la confirmación y «no se puede copiar de la misma» los rechaza antes el guard):
 *  - `ORIGEN_NO_ENCONTRADO`: la sucursal de origen no existe o está desactivada (se lee FUERA de la transacción);
 *  - `ORIGEN_SIN_ACCESO`: existe, pero quien copia no tiene membresía vigente ni el «Ver» de la carta (`carta_ver`) en ESA sucursal (S-07, O.56);
 *  - `CARTA_PROPIA_EXISTENTE`: el destino ya tiene un contenido, un género o un ítem agrupado propios (solo se copia sobre una carta VACÍA); gana sobre `ORIGEN_SIN_CARTA`;
 *  - `ORIGEN_SIN_CARTA`: el origen no tiene nada que copiar;
 *  - `CARTA_CAMBIO`: el conflicto de escritura agotó los reintentos (otra copia o edición a la vez).
 */
export type ResultadoCopiarCartaDeSucursal = ResultadoCaso<DatosCartaCopiada, "ORIGEN_NO_ENCONTRADO" | "ORIGEN_SIN_ACCESO" | "CARTA_PROPIA_EXISTENTE" | "ORIGEN_SIN_CARTA" | "CARTA_CAMBIO">;
