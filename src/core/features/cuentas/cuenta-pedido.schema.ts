import type { EleccionDeCupo } from "@/core/pos/public";
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

/** Un ítem suelto que pide el mozo, para el segundo parámetro de `agregarItems`. */
export interface ItemParaAgregar {
  productoId: string;
  cantidad: number;
}

/** Una promo armada por el mozo, para el tercer parámetro de `agregarItems` (Task #16, docs/plan-promo-combo-2026-09-26.md, paso 8a). */
export interface PromoParaAgregar {
  promoCartaId: string;
  elecciones: EleccionDeCupo[];
}

/**
 * Comando «agregar ítems y promos sin enviar»: lo que recibe `agregarItemsCasoDeUso`, con las dos listas YA vistas por `guardComandoAgregarItems` (lo que no es
 * una lista llega como lista vacía, como antes; al menos un ítem o una promo; a lo sumo `MAXIMO_ITEMS_POR_AGREGADO` líneas contando los componentes) y el
 * `cuentaId` visto como texto. Cada elemento viaja como llegó, con los tipos que declara la Server Action: el caso de uso lo revalida uno por uno en el MISMO
 * lugar que antes (producto, disponibilidad, cantidad, promo), así cada combinación inválida sigue respondiendo el mismo mensaje.
 */
export interface ComandoAgregarItems {
  cuentaId: string;
  items: ItemParaAgregar[];
  promos: PromoParaAgregar[];
}

/**
 * Solo lo que produce el caso de uso (las listas vacías, el tope y un `cuentaId` que no es texto los rechaza antes el guard), en el orden en que se chequean:
 *  - `CUENTA_NO_ABIERTA`: no es una cuenta de una mesa de esta sucursal, o ya está cerrada (`cuentaAbiertaDeSucursal`);
 *  - `PRODUCTO_INVALIDO`: un ítem suelto no existe, no es PV, no está disponible en la sucursal o su cantidad no pasa `validarCantidadPedido`;
 *  - `PROMO_INVALIDA`: una promo no existe o no está disponible, su elección no cumple los cupos, o no se puede prorratear.
 * Todo se valida ANTES de la primera escritura: un rechazo no deja nada escrito.
 */
export type ResultadoAgregarItems = ResultadoCaso<null, "CUENTA_NO_ABIERTA" | "PRODUCTO_INVALIDO" | "PROMO_INVALIDA">;

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

/**
 * Comando «enviar a cocina»: lo que recibe `enviarACocinaCasoDeUso`, con los `itemIds` ya validados por `guardComandoEnviarACocina` (una lista no vacía de
 * textos, a lo sumo `MAXIMO_ITEMS_POR_ENVIO`) y el `cuentaId` ya visto como texto (ese chequeo va DESPUÉS de los de la lista, como antes).
 */
export interface ComandoEnviarACocina {
  cuentaId: string;
  itemIds: string[];
}

/**
 * `datos` de un envío: el número de envío y si lo creó ESTA llamada (la pantalla imprime la comanda solo de un envío nuevo). En el caso idempotente (ningún id
 * seguía sin enviar) `numeroEnvio` es el envío en el que ya habían salido, o `null` si ninguno está enviado en esta cuenta, y `envioNuevo` es `false`. La
 * Server Action los copia a mano en su `ResultadoEnvioACocina` (solo estos dos campos: nunca ids internos).
 */
export interface DatosEnviarACocina {
  numeroEnvio: number | null;
  envioNuevo: boolean;
}

/** Solo lo que produce el caso de uso: `CUENTA_NO_ABIERTA` (no es una cuenta de una mesa de esta sucursal, o ya está cerrada; `cuentaAbiertaDeSucursal`). */
export type ResultadoEnviarACocina = ResultadoCaso<DatosEnviarACocina, "CUENTA_NO_ABIERTA">;
