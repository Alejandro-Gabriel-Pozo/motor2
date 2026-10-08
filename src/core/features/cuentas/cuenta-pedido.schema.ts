import type { ResultadoCaso } from "@/core/resultado-caso";

/**
 * Tipos del PEDIDO de la cuenta de una mesa (feature Cuenta del salón, módulo POS; Hito 4 de la pureza, bloque 4.1 — `docs/plan-hito-4-pureza.md` §5): comandos y
 * resultados de los casos de uso de `src/server/actions/pos/casos-de-uso/` que vienen de `src/server/actions/pos/cuenta-pedido.ts` (agregar ítems y promos sin
 * enviar, quitarlos mientras no salieron y enviarlos a cocina). Archivo aparte de `cuenta-apertura.schema.ts`, `cuenta.schema.ts` (cierre y ticket) y
 * `cuenta-anulacion.schema.ts` por el mismo corte que ya tienen las Server Actions.
 *
 * Los comandos traen el id YA validado por su guard (solo que sea un texto: si no, «no encontrado», el mismo mensaje que antes); lo demás lo valida el caso de
 * uso en el MISMO lugar que antes, así cada combinación inválida sigue respondiendo el mismo mensaje (lo fija `huella-del-pos`).
 */

/** Comando «quitar un ítem que todavía no salió a cocina»: lo que recibe `quitarItemSinEnviarCasoDeUso`. */
export interface ComandoQuitarItemSinEnviar {
  cuentaItemId: string;
}

/**
 * Solo lo que produce el caso de uso (un `cuentaItemId` que no es un texto lo rechaza antes el guard), en este orden:
 *  - `NO_ENCONTRADO`: no hay ítem con ese id en una mesa de esta sucursal;
 *  - `COMPONENTE_DE_PROMO`: es parte de una promo — se quita la promo entera (Task #16, D4);
 *  - `CUENTA_NO_ABIERTA`: la cuenta del ítem ya está cerrada (`cuentaAbiertaDeSucursal`, con su mensaje);
 *  - `YA_ENVIADO`: el borrado condicional no borró nada (otro mozo lo envió un instante antes, o es una fila espejo): se anula con motivo.
 */
export type ResultadoQuitarItemSinEnviar = ResultadoCaso<null, "NO_ENCONTRADO" | "COMPONENTE_DE_PROMO" | "CUENTA_NO_ABIERTA" | "YA_ENVIADO">;

/** Comando «quitar una promo entera que todavía no salió a cocina»: lo que recibe `quitarPromoSinEnviarCasoDeUso`. */
export interface ComandoQuitarPromoSinEnviar {
  promoCuentaId: string;
}

/**
 * Solo lo que produce el caso de uso (un `promoCuentaId` que no es un texto lo rechaza antes el guard), en este orden:
 *  - `NO_ENCONTRADA`: no hay promo con ese id en una mesa de esta sucursal;
 *  - `CUENTA_CERRADA`: la cuenta de la promo ya está cerrada;
 *  - `YA_ENVIADA`: algún componente ya salió a cocina (o es una fila espejo): la promo se anula entera con motivo (`anularPromoEnviada`).
 */
export type ResultadoQuitarPromoSinEnviar = ResultadoCaso<null, "NO_ENCONTRADA" | "CUENTA_CERRADA" | "YA_ENVIADA">;
